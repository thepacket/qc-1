"""The block library (src/calc/blockLib.ts).

Each block's k-qubit operator is built from the Qiskit object it is named
after, then placed on the case's qubits as is, inverted (U†) or with one
control. QC-1's unitary must equal it exactly, global phase included, and so
must Qiskit's import of QC-1's OpenQASM export:

  Bell Pair, GHZ State   the same gates in Qiskit (QC-1 definitions), and the
                         image of |0…0⟩ checked against the target state
  Uniform Superposition  UniformSuperpositionGate(M, k)
  Graph State            GraphStateGate(adjacency)
  QFT, QFT†              QFTGate(k) (inverse) for the defaults; synth_qft_full
                         with do_swaps / approximation_degree otherwise
  Marked-State Oracle    DiagonalGate(±1)
  Diffuser               2|s⟩⟨s| − I
  Grover Operator        grover_operator(oracle) ** iterations
  Real Amplitudes        real_amplitudes(k, entanglement, reps, skip_final…)
  Efficient SU(2)        efficient_su2(k, …)
  QAOA Ansatz            qaoa_ansatz(Σ ZᵢZⱼ over the edges, reps, initial state)
  Pauli Evolution        PauliEvolutionGate(H, T, LieTrotter / SuzukiTrotter)
  Phase Estimation       phase_estimation(m, U)
  Pauli Measurement      ⟨P⟩ = Statevector.expectation_value(Pauli) against
                         1 − 2·P(ancilla = 1), on seeded states

Symbolic parameters are bound to the case's seeded values by name (Qiskit's
θ[i], β[i], γ[i] ↔ QC-1's theta_i, beta_i, gamma_i).
"""
import json
import warnings

import numpy as np
from qiskit import QuantumCircuit, qasm3
from qiskit.circuit.library import (
    DiagonalGate, GraphStateGate, PauliEvolutionGate, QFTGate, UniformSuperpositionGate, UnitaryGate,
    efficient_su2, grover_operator, phase_estimation, qaoa_ansatz, real_amplitudes,
)
from qiskit.quantum_info import Operator, Pauli, SparsePauliOp, Statevector
from qiskit.synthesis import LieTrotter, SuzukiTrotter, synth_qft_full

from common import OUT, fail, r, write_fixture

warnings.filterwarnings("ignore", module="scipy.sparse")

TOL = 1e-10


def cmat(cols):
    """QC-1's interleaved columns → a complex matrix."""
    return np.array([np.array(col[0::2]) + 1j * np.array(col[1::2]) for col in cols]).T


def bits(text):
    return [b for b in (x.strip() for x in text.replace(";", ",").split(",")) if b]


def edges(text):
    return [tuple(int(v) for v in e.split("-")) for e in bits(text)]


def bind(qc, values):
    return qc.assign_parameters(values) if qc.parameters else qc


def block_operator(c):
    """The block's k-qubit operator from its Qiskit object."""
    b, s, k, scope = c["block"], c["settings"], len(c["qubits"]), c["scope"]
    if b == "bell":
        qc = QuantumCircuit(2)
        qc.h(0)
        if s["variant"] == "phi-":
            qc.z(0)
        if s["variant"].startswith("psi"):
            qc.x(1)
        qc.cx(0, 1)
        if s["variant"] == "psi-":
            qc.z(1)
        U = Operator(qc).data
        h = 2 ** -0.5
        target = {"phi+": [h, 0, 0, h], "phi-": [h, 0, 0, -h], "psi+": [0, h, h, 0], "psi-": [0, h, -h, 0]}[s["variant"]]
        if np.max(np.abs(U[:, 0] - np.array(target))) > TOL:
            fail(f"blocks {c['id']}: |00⟩ doesn't go to the {s['variant']} state")
        return U
    if b == "ghz":
        qc = QuantumCircuit(k)
        qc.h(0)
        for q in range(k - 1):
            qc.cx(q, q + 1)
        U = Operator(qc).data
        target = np.zeros(2 ** k)
        target[0] = target[-1] = 2 ** -0.5
        if np.max(np.abs(U[:, 0] - target)) > TOL:
            fail(f"blocks {c['id']}: |0…0⟩ doesn't go to the GHZ state")
        return U
    if b == "unif":
        return Operator(UniformSuperpositionGate(int(s["M"]), k)).data
    if b == "graph":
        A = np.zeros((k, k), dtype=int)
        for a, bb in edges(s["edges"]):
            A[a, bb] = A[bb, a] = 1
        return Operator(GraphStateGate(A)).data
    if b in ("qft", "iqft"):
        approx, swaps = int(s["approx"]), s["swaps"] != "no"
        qc = synth_qft_full(k, do_swaps=swaps, approximation_degree=approx)
        U = Operator(qc).data
        if approx == 0 and swaps and np.max(np.abs(U - Operator(QFTGate(k)).data)) > TOL:
            fail(f"blocks {c['id']}: synth_qft_full differs from QFTGate")
        return U.conj().T if b == "iqft" else U
    if b in ("oracle", "grover"):
        d = np.ones(2 ** k)
        for m in bits(s["marked"]):
            d[int(m, 2)] = -1
        orc = QuantumCircuit(k)
        orc.append(DiagonalGate(list(d)), range(k))
        if b == "oracle":
            return Operator(orc).data
        G = Operator(grover_operator(orc)).data
        return np.linalg.matrix_power(G, int(s["iterations"]))
    if b == "diff":
        v = np.full(2 ** k, 2 ** (-k / 2))
        return 2 * np.outer(v, v) - np.eye(2 ** k)
    if b in ("realamp", "esu2"):
        make = real_amplitudes if b == "realamp" else efficient_su2
        qc = make(k, entanglement=s["entanglement"], reps=int(s["reps"]), skip_final_rotation_layer=s["final"] == "no")
        prefix = s["prefix"]
        vals = {p: scope[f"{prefix}_{int(p.name.split('[')[1][:-1])}"] for p in qc.parameters}
        return Operator(bind(qc, vals)).data
    if b == "qaoa":
        es = edges(s["edges"])
        cost = SparsePauliOp.from_sparse_list([("ZZ", [a, bb], 1.0) for a, bb in es], num_qubits=k)
        qc = qaoa_ansatz(cost, reps=int(s["layers"]), initial_state=None if s["init"] != "no" else QuantumCircuit(k))
        name = {"β": "beta", "γ": "gamma"}
        vals = {p: scope[f"{name[p.name[0]]}_{int(p.name.split('[')[1][:-1])}"] for p in qc.parameters}
        return Operator(bind(qc, vals)).data
    if b == "pevo":
        op = SparsePauliOp.from_list([(lab, coef) for lab, coef in c["qc1"]["terms"]])
        T = scope["t"] if s["time"] == "t" else float(s["time"])
        steps, order = int(s["steps"]), int(s["order"])
        synth = LieTrotter(reps=steps) if order == 1 else SuzukiTrotter(order=order, reps=steps)
        qc = QuantumCircuit(k)
        qc.append(PauliEvolutionGate(op, time=T, synthesis=synth), range(k))
        return Operator(qc.decompose(reps=6)).data
    if b == "qpe":
        U = UnitaryGate(cmat(c["qc1"]["gateMatrix"]))
        return Operator(phase_estimation(int(s["m"]), U)).data
    raise ValueError(b)


def reference(c):
    """The block on the case's qubits: as is, inverted, or with one control."""
    n, qs = c["n"], c["qubits"]
    U = block_operator(c)
    qc = QuantumCircuit(n)
    if c["mode"] == "plain":
        qc.append(UnitaryGate(U), qs)
    elif c["mode"] == "inverse":
        qc.append(UnitaryGate(U.conj().T), qs)
    else:
        qc.append(UnitaryGate(U).control(1), [c["control"]] + qs)
    return Operator(qc).data


def imported(c):
    """Qiskit's import of QC-1's export, with the symbols bound by name (t is exported as t_)."""
    qc = qasm3.loads(c["qc1"]["qasm"])
    names = {("t" if p.name == "t_" else p.name): p for p in qc.parameters}
    return Operator(bind(qc, {p: c["scope"][nm] for nm, p in names.items()})).data


def main():
    doc = json.load(open(OUT / "blocks.cases.json"))
    out, worst, count = [], 0.0, 0
    for c in doc["cases"]:
        if c["block"] == "paulimeas":
            lab = c["settings"]["pauli"]
            want = [float(Statevector(np.array(v[0::2]) + 1j * np.array(v[1::2])).expectation_value(Pauli(lab)).real) for v in c["states"]]
            got = c["qc1"]["values"]
            err = max(abs(a - b) for a, b in zip(got, want))
            worst = max(worst, err)
            if err > TOL:
                fail(f"blocks {c['id']}: ⟨{lab}⟩ differs by {err:.2e}")
            if c["qc1"]["first"] != "reset" or c["qc1"]["last"] != "measure":
                fail(f"blocks {c['id']}: expected reset … measure, got {c['qc1']['first']} … {c['qc1']['last']}")
            out.append({"id": c["id"], "values": [r(x) for x in want]})
            count += 1
            continue
        mine = cmat(c["qc1"]["unitary"])
        ref = reference(c)
        err = float(np.max(np.abs(mine - ref)))
        worst = max(worst, err)
        if err > TOL:
            fail(f"blocks {c['id']}: QC-1 differs from the reference by {err:.2e}")
        exp = imported(c)
        if np.max(np.abs(exp - ref)) > TOL:
            fail(f"blocks {c['id']}: Qiskit's import of the export differs by {np.max(np.abs(exp - ref)):.2e}")
        out.append({"id": c["id"], "n": c["n"], "unitary": {"re": [[r(z.real) for z in row] for row in ref.T], "im": [[r(z.imag) for z in row] for row in ref.T]}})
        count += 1
    print(f"  blocks: {count} cases, worst difference {worst:.2e}")
    write_fixture("blocks", "qiskit.circuit.library block objects (see g_blocks.py), inverted and controlled; Qiskit import of the export", out, {"abs": TOL})


if __name__ == "__main__":
    main()
