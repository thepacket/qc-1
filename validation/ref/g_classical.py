"""Phase 7 references: mid-circuit measurement and classical control.

Qiskit imports QC-1's export (c[q] ← measure q[q]; `if (c[k] == true/false)`
as if_else) and an independent interpreter runs it: gates via
Statevector.evolve, each executed measurement/reset projected onto QC-1's
recorded outcome, conditions evaluated on the classical bits. The final
state and classical bits must equal QC-1's; resources match Qiskit's
size/depth (classical wires included) and counts.
"""
import json

import numpy as np
from qiskit import qasm3
from qiskit.circuit.library import XGate
from qiskit.quantum_info import Statevector

from common import OUT, fail, r, write_fixture
from g_tools import check_resources

MEAS = {"measure", "measure_x", "measure_y", "reset"}


def run(qc, n, outcomes):
    psi = Statevector.from_label("0" * n)
    bits = [0] * qc.num_clbits
    queue = list(outcomes)

    def project(q, o):
        nonlocal psi
        data = psi.data.copy()
        for i in range(len(data)):
            if ((i >> q) & 1) != o:
                data[i] = 0
        nrm = np.linalg.norm(data)
        if nrm < 1e-12:
            fail("recorded outcome has probability 0")
        psi = Statevector(data / nrm)

    def execute(ops, qmap, cmap):
        nonlocal psi
        for inst in ops:
            name = inst.operation.name
            qi = [qmap[q] for q in inst.qubits]
            if name == "if_else":
                (clbit, val) = inst.operation.condition
                cidx = cmap[clbit]
                body = inst.operation.params[0]
                if bits[cidx] == int(val):
                    execute(body.data, dict(zip(body.qubits, qi)), dict(zip(body.clbits, [cmap[c] for c in inst.clbits])))
                else:
                    # A skipped measurement/reset consumes its (unused) slot.
                    for b in body.data:
                        if b.operation.name in ("measure", "reset"):
                            queue.pop(0)
                continue
            if name in ("measure", "reset"):
                o = queue.pop(0)
                project(qi[0], o)
                if name == "measure":
                    bits[cmap[inst.clbits[0]]] = o
                elif o == 1:
                    psi = psi.evolve(XGate(), [qi[0]])
                continue
            if name == "barrier":
                continue
            psi = psi.evolve(inst.operation, qi)

    execute(qc.data, {q: i for i, q in enumerate(qc.qubits)}, {c: i for i, c in enumerate(qc.clbits)})
    return psi.data, bits


def branches(qc, n):
    """Every measurement history: (path of outcomes) → (probability, final bits c0…c(n−1))."""
    leaves = {}

    def split(psi, q, prob_min=1e-12):
        out = []
        for o in (0, 1):
            data = psi.data.copy()
            for i in range(len(data)):
                if ((i >> q) & 1) != o:
                    data[i] = 0
            p = float(np.vdot(data, data).real)
            if p > prob_min:
                out.append((o, p, Statevector(data / np.sqrt(p))))
        return out

    def walk(stack, psi, bits, p, path):
        # stack: list of (ops, qmap, cmap, index) frames; runs to the end or the next event.
        while stack:
            ops, qmap, cmap, i = stack[-1]
            if i >= len(ops):
                stack.pop()
                continue
            stack[-1] = (ops, qmap, cmap, i + 1)
            inst = ops[i]
            name = inst.operation.name
            qi = [qmap[q] for q in inst.qubits]
            if name == "if_else":
                clbit, val = inst.operation.condition
                if bits[cmap[clbit]] == int(val):
                    body = inst.operation.params[0]
                    stack.append((body.data, dict(zip(body.qubits, qi)), dict(zip(body.clbits, [cmap[c] for c in inst.clbits])), 0))
                continue
            if name in ("measure", "reset"):
                for o, po, child in split(psi, qi[0]):
                    b2 = list(bits)
                    if name == "measure":
                        b2[cmap[inst.clbits[0]]] = o
                    elif o == 1:
                        child = child.evolve(XGate(), [qi[0]])
                    walk([f for f in stack], child, b2, p * po, path + str(o))
                return
            if name == "barrier":
                continue
            psi = psi.evolve(inst.operation, qi)
        leaves[path] = (p, "".join(str(b) for b in reversed(bits)))  # c[k-1] … c[0], as Qiskit prints

    walk([(qc.data, {q: i for i, q in enumerate(qc.qubits)}, {c: i for i, c in enumerate(qc.clbits)}, 0)],
         Statevector.from_label("0" * n), [0] * max(n, qc.num_clbits), 1.0, "")
    return leaves


def for_aer(qc):
    """The same program in a form qiskit-aer 0.17 loads. Aer fails on a one-bit
    condition compared with false, and on a condition reading a bit nothing
    has written yet; both rewrite exactly: an unwritten bit is 0 (drop the
    gate, or inline its body), and `== false` becomes an else branch."""
    from qiskit.circuit import IfElseOp
    out = qc.copy_empty_like()
    written = set()
    for inst in qc.data:
        op = inst.operation
        if op.name == "if_else":
            clbit, val = op.condition
            body = op.params[0]
            for b in body.data:
                if b.operation.name == "measure":
                    written.add(inst.clbits[body.find_bit(b.clbits[0]).index])
            if clbit not in written:
                if int(val) == 0:
                    for b in body.data:
                        out.append(b.operation, [inst.qubits[body.find_bit(q).index] for q in b.qubits],
                                   [inst.clbits[body.find_bit(c).index] for c in b.clbits])
                continue
            if int(val) == 0:
                op = IfElseOp((clbit, True), body.copy_empty_like(), body)
        if op.name == "measure":
            written.add(inst.clbits[0])
        out.append(op, inst.qubits, inst.clbits)
    return out


def aer_check(qc, n, leaves, cid):
    from qiskit_aer import AerSimulator
    def measures(ops):
        return any(i.operation.name == "measure" or (i.operation.name == "if_else" and measures(i.operation.params[0].data)) for i in ops)
    prog = for_aer(qc)
    if not measures(prog.data):
        return 0.0  # nothing is ever measured: Aer returns no counts (the single branch is checked above)
    shots = 20000
    from qiskit import transpile
    sim = AerSimulator(seed_simulator=1234)
    # Aer needs its own basis inside if_else bodies.
    result = sim.run(transpile(prog, sim, optimization_level=0), shots=shots).result()
    if not result.success:
        # qiskit-aer 0.17.2 fails to load some valid dynamic circuits ("unordered_map::at: key not
        # found", every method, with or without transpile). The case is still checked against the
        # interpreter and the branch enumerator above; a disagreement with Aer, when it runs, fails.
        print(f"  classical {cid}: Aer could not load the program (Aer bug); checked by the interpreter and branches only")
        return None
    counts = result.get_counts()
    dist = {}
    for p, bits in leaves.values():
        dist[bits] = dist.get(bits, 0) + p
    worst = 0.0
    for bits, p in dist.items():
        key = bits  # both print c[n-1] … c[0]
        f = counts.get(key, 0) / shots
        sigma = np.sqrt(max(p * (1 - p), 1e-9) / shots)
        worst = max(worst, abs(f - p) / sigma)
        if abs(f - p) > 5 * sigma + 1e-3:
            fail(f"classical {cid}: Aer frequency {f:.4f} vs QC-1 branches {p:.4f} for c={bits}")
    extra = sum(v for k, v in counts.items() if k not in dist) / shots
    if extra > 1e-3:
        fail(f"classical {cid}: Aer saw outcomes QC-1 says are impossible ({extra:.4f})")
    return worst


def main():
    doc = json.load(open(OUT / "classical.cases.json"))
    out = []
    for c in doc["cases"]:
        n, qc1 = c["n"], c["qc1"]
        qc = qasm3.loads(c["qasm"])
        outcomes = [s.get("outcome") for e in c["tape"] for s in e if s["gateId"] in MEAS]
        psi, bits = run(qc, n, outcomes)
        mine = np.array(qc1["state"][0::2]) + 1j * np.array(qc1["state"][1::2])
        err = float(np.max(np.abs(psi - mine)))
        if err > 1e-9:
            fail(f"classical {c['id']}: state differs by {err:.2e}")
        if (bits or [0] * n) != qc1["cbits"]:
            fail(f"classical {c['id']}: classical bits {qc1['cbits']} vs {bits}")
        res = check_resources(f"classical {c['id']}", qc, qc1["resources"])
        tree, aer = None, 0.0
        if qc1["branches"] is not None:
            ref = branches(qc, n)
            mine = {b["path"]: (b["p"], b["cbits"]) for b in qc1["branches"]}
            if set(ref) != set(mine):
                fail(f"classical {c['id']}: branch paths {sorted(mine)} vs {sorted(ref)}")
            for k, (p, bits) in ref.items():
                if abs(mine[k][0] - p) > 1e-9 or mine[k][1] != bits:
                    fail(f"classical {c['id']}: branch {k}: QC-1 {mine[k]} vs {(p, bits)}")
            aer = aer_check(qc, n, ref, c["id"])
            tree = [{"path": k, "p": r(p), "cbits": bits} for k, (p, bits) in sorted(ref.items())]
        case = {"id": c["id"], "n": n, "tape": c["tape"], "cbits": qc1["cbits"], "resources": res, "branches": tree}
        if tree is not None and aer is None:
            case["aer"] = "not loadable by qiskit-aer (its bug): interpreter and branch enumerator only"
        out.append(case)
    print(f"  classical: {len(out)} cases")
    write_fixture("classical", "qiskit qasm3 import (if_else) + interpreter forcing recorded outcomes; branch enumerator; Aer counts (5σ); count_ops/depth", out, {"abs": 1e-9})


if __name__ == "__main__":
    main()
