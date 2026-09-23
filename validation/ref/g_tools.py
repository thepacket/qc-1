"""Phase 6 references: circuit tools and circuit resources.

For every case and every tool (optimise, deep optimise, transpile to three
targets, routing onto line/ring coupling maps, compile, inverse) Qiskit
imports QC-1's QASM export of the input and of the tool's output and checks:

  * the operator is kept, up to a global phase: U_out = e^{iφ} P·U_in, with P
    the routing permutation (identity otherwise); the inverse must give
    U_out = e^{iφ} U_in†. Every tool must pass, and QC-1's own in-app verdict
    (src/calc/equiv.ts) must agree;
  * for transpilation, the number of instructions outside the target basis
    equals QC-1's count (gates the transpiler reports as skipped);
  * circuit resources match Qiskit's definitions: size, depth, 1/2/multi-
    qubit counts, T count, T-depth (depth filtered to T/T†), CX count,
    Clifford count (each instruction's Operator conjugates X_q, Z_q to a
    single Pauli; decided with SparsePauliOp.from_operator), parameterized
    instructions, and the busiest qubit.
"""
import json

import numpy as np
from qiskit import qasm3
from qiskit.converters import circuit_to_dag
from qiskit.quantum_info import Operator, SparsePauliOp, Statevector

from common import OUT, fail, load_cases, write_fixture

EQ_TOL = 1e-8
NATIVE = {
    "clifford-t": {"id", "x", "y", "z", "h", "s", "sdg", "t", "tdg", "cx"},
    "ibm-heavy-hex": {"id", "rz", "sx", "cx"},
    "rigetti": {"id", "rz", "cz"},
}
TARGET = {"transpile-clifford-t": "clifford-t", "transpile-ibm-heavy-hex": "ibm-heavy-hex",
          "transpile-rigetti": "rigetti", "compile-ibm-line": "ibm-heavy-hex"}


def be_unitary(qc):
    return Operator(qc).reverse_qargs().data


def perm_matrix(n, perm):
    """Big-endian: logical qubit l moves to physical qubit perm[l]."""
    d = 1 << n
    P = np.zeros((d, d))
    for i in range(d):
        j = 0
        for l in range(n):
            if (i >> (n - 1 - l)) & 1:
                j |= 1 << (n - 1 - perm[l])
        P[j, i] = 1
    return P


def phase_err(expected, got):
    k = np.unravel_index(np.argmax(np.abs(expected)), expected.shape)
    ph = got[k] / expected[k]
    return float(max(abs(abs(ph) - 1), np.max(np.abs(ph * expected - got))))


def is_id(inst):
    """stdgates `id`, which qiskit-qasm3-import reads as U(0, 0, 0)."""
    op = inst.operation
    return op.name == "id" or (op.name == "u" and all(float(x) == 0 for x in op.params))


def is_rx_half_pi(inst):
    return inst.operation.name == "rx" and abs(abs(float(inst.operation.params[0])) - np.pi / 2) < 1e-12


def is_clifford(inst):
    op = inst.operation
    if op.name in ("measure", "reset", "barrier"):
        return False
    try:
        U = Operator(op).data
    except Exception:
        return False
    k = op.num_qubits
    for q in range(k):
        for p in "XZ":
            label = "".join(p if i == q else "I" for i in range(k))
            P = SparsePauliOp(label).to_matrix()
            M = SparsePauliOp.from_operator(U @ P @ U.conj().T).simplify(atol=1e-9)
            if len(M) != 1 or abs(abs(M.coeffs[0]) - 1) > 1e-9:
                return False
    return True


def resources(qc):
    ops = [i for i in qc.data if i.operation.name != "barrier"]
    per_q = {}
    for i in ops:
        for q in i.qubits:
            per_q[q] = per_q.get(q, 0) + 1
    unitary = [i for i in ops if i.operation.name not in ("measure", "reset")]
    return {
        "gates": len(ops),
        "oneQubit": sum(1 for i in unitary if i.operation.num_qubits == 1),
        "twoQubit": sum(1 for i in unitary if i.operation.num_qubits == 2),
        "multiQubit": sum(1 for i in unitary if i.operation.num_qubits >= 3),
        "measurements": sum(1 for i in ops if i.operation.name == "measure"),
        "resets": sum(1 for i in ops if i.operation.name == "reset"),
        "depth": qc.depth(),
        "tCount": sum(1 for i in ops if i.operation.name in ("t", "tdg")),
        "tDepth": qc.depth(filter_function=lambda i: i.operation.name in ("t", "tdg")),
        "cxCount": sum(1 for i in ops if i.operation.name == "cx"),
        "cliffordCount": sum(1 for i in unitary if is_clifford(i)),
        "parameterized": sum(1 for i in ops if len(i.operation.params) > 0 and not is_id(i)),
        "longestQubit": max(per_q.values(), default=0),
    }


def check_resources(where, qc, qc1):
    ref = resources(qc)
    for k, v in ref.items():
        if qc1[k] != v:
            fail(f"tools {where}: {k} QC-1 {qc1[k]} vs Qiskit {v}")
    return ref


MEASURE_IDS = {"measure", "measure_x", "measure_y", "reset"}


def interaction(qc, n):
    w = np.zeros((n, n), dtype=int)
    for inst in qc.data:
        qs = sorted({qc.find_bit(q).index for q in inst.qubits})
        if len(qs) < 2 or inst.operation.name in ("measure", "barrier"):
            continue
        for i in range(len(qs)):
            for j in range(i + 1, len(qs)):
                w[qs[i], qs[j]] += 1
                w[qs[j], qs[i]] += 1
    return w.tolist()


def backward_cones(qc):
    """Per measurement, in program order: the measured qubit plus the qubits of every
    non-measurement operation it causally depends on (DAG ancestors)."""
    dag = circuit_to_dag(qc)
    out = []
    for node in dag.topological_op_nodes():
        if node.op.name != "measure":
            continue
        q = qc.find_bit(node.qargs[0]).index
        sup = {q}
        for a in dag.ancestors(node):
            if hasattr(a, "op") and a.op.name != "measure":
                sup |= {qc.find_bit(x).index for x in a.qargs}
        out.append({"qubit": q, "support": sorted(sup)})
    return out


def post_selected_state(qc, n, outcomes):
    """Statevector of the exported program with each measurement/reset forced to QC-1's recorded outcome."""
    psi = Statevector.from_label("0" * n)
    k = 0
    for inst in qc.data:
        name = inst.operation.name
        qi = [qc.find_bit(q).index for q in inst.qubits]
        if name in ("measure", "reset"):
            o = outcomes[k]
            k += 1
            q = qi[0]
            data = psi.data.copy()
            # Qiskit is little-endian: qubit q is bit q of the index.
            for i in range(len(data)):
                if ((i >> q) & 1) != o:
                    data[i] = 0
            data /= np.linalg.norm(data)
            psi = Statevector(data)
            if name == "reset" and o == 1:
                from qiskit.circuit.library import XGate
                psi = psi.evolve(XGate(), [q])
            continue
        if name == "barrier":
            continue
        psi = psi.evolve(inst.operation, qi)
    return psi.reverse_qargs().data


def gf2_rank(rows):
    rows = [r[:] for r in rows]
    rank = 0
    for col in range(len(rows[0]) if rows else 0):
        piv = next((i for i in range(rank, len(rows)) if rows[i][col]), None)
        if piv is None:
            continue
        rows[rank], rows[piv] = rows[piv], rows[rank]
        for i in range(len(rows)):
            if i != rank and rows[i][col]:
                rows[i] = [a ^ b for a, b in zip(rows[i], rows[rank])]
        rank += 1
    return rank


def check_structure(c):
    n, qc1 = c["n"], c["qc1"]
    qc = qasm3.loads(c["qasm"])
    res = check_resources(f"structure {c['id']}", qc, qc1["resources"])
    inter = interaction(qc, n)
    if inter != qc1["interaction"]:
        fail(f"structure {c['id']}: interaction {qc1['interaction']} vs Qiskit {inter}")
    cones = backward_cones(qc)
    if cones != qc1["tanner"]:
        fail(f"structure {c['id']}: tanner {qc1['tanner']} vs Qiskit DAG {cones}")
    outcomes = [s["outcome"] for e in c["tape"] for s in e if s["gateId"] in MEASURE_IDS]
    psi = post_selected_state(qc, n, outcomes)
    mine = np.array(qc1["state"][0::2]) + 1j * np.array(qc1["state"][1::2])
    if np.max(np.abs(psi - mine)) > 1e-9:
        fail(f"structure {c['id']}: post-selected state differs from QC-1's")
    gens = qc1["generators"]
    if gens is None:
        fail(f"structure {c['id']}: QC-1 says not Clifford")
    for g in gens:
        P = SparsePauliOp(g[1:]).to_matrix() * (-1 if g[0] == "-" else 1)
        ev = np.real(np.vdot(psi, P @ psi))
        if abs(ev - 1) > 1e-9:
            fail(f"structure {c['id']}: generator {g} has <P> = {ev}")
    bits = [[1 if p in "XY" else 0 for p in g[1:]] + [1 if p in "ZY" else 0 for p in g[1:]] for g in gens]
    if gf2_rank(bits) != n:
        fail(f"structure {c['id']}: generators not independent")
    return {"id": c["id"], "n": n, "tape": c["tape"], "resources": res, "interaction": inter, "tanner": cones, "generators": gens}


def main():
    doc = json.load(open(OUT / "tools.cases.json"))
    structure = [check_structure(c) for c in doc["structure"]]
    cases = load_cases("tools")
    out = []
    worst = 0.0
    for c in cases:
        n, qc1 = c["n"], c["qc1"]
        qa = qasm3.loads(c["qasm"])
        UA = be_unitary(qa)
        entry = {"id": c["id"], "n": n, "tape": c["tape"], "resources": check_resources(c["id"], qa, qc1["resources"]), "tools": {}}
        for name, t in qc1["tools"].items():
            qb = qasm3.loads(t["qasm"])
            UB = be_unitary(qb)
            if name == "inverse":
                expected = UA.conj().T
            elif t["perm"] is not None:
                expected = perm_matrix(n, t["perm"]) @ UA
            else:
                expected = UA
            err = phase_err(expected, UB)
            worst = max(worst, err)
            equal = err < EQ_TOL
            if not equal:
                fail(f"tools {c['id']}: {name} changed the operator (err {err:.2e})")
            if equal != t["equal"]:
                fail(f"tools {c['id']}: {name} QC-1 equivalence verdict {t['equal']} vs Qiskit {equal}")
            non_native = None
            if name in TARGET:
                allowed = NATIVE[TARGET[name]]
                non_native = sum(1 for i in qb.data if i.operation.name not in allowed and not is_id(i)
                                 and not (TARGET[name] == "rigetti" and is_rx_half_pi(i)))
                if non_native != t["nonNative"]:
                    fail(f"tools {c['id']}: {name} non-native count QC-1 {t['nonNative']} vs Qiskit {non_native}")
            entry["tools"][name] = {
                "equal": equal, "perm": t["perm"], "nonNative": non_native, "skipped": t["skipped"],
                "resources": check_resources(f"{c['id']}/{name}", qb, t["resources"]),
            }
        out.append(entry)
    print(f"  tools: worst operator error {worst:.2e} over {len(out)} cases; {len(structure)} structure cases")
    write_fixture("tools", "qiskit Operator equivalence (up to global phase, routing permutation), count_ops/depth, SparsePauliOp Clifford test", out, {"equiv": EQ_TOL})
    write_fixture("structure", "qiskit count_ops/depth, DAG ancestors of each measurement, post-selected Statevector (<g> = +1, GF(2) rank n)", structure, {})


if __name__ == "__main__":
    main()
