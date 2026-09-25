"""Phase 10 references: stabilizer mode.

  * n = 30, 64, 128, 200 random Clifford tapes (every Clifford gate kind QC-1
    has, controls and anti-controls, π/2 rotations): Qiskit builds
    StabilizerState(Clifford(circuit)) from QC-1's QASM export; every QC-1
    generator must have expectation +1 and the n generators must be
    independent (GF(2) rank n).
  * n ≤ 6 tapes with measurements, resets, preps and IF (recorded outcomes):
    every generator must fix the post-selected statevector (g_classical's
    interpreter over Qiskit's import), and the classical bits must match.
"""
import json

import numpy as np
from qiskit import qasm3
from qiskit.quantum_info import Clifford, Operator, Pauli, SparsePauliOp, StabilizerState

from common import OUT, fail, write_fixture
from g_classical import run as run_classical
from g_tools import gf2_rank


def clifford_of(qc):
    """The circuit's Clifford, built instruction by instruction from each Operator
    (each instruction as the program defines it). main() also checks it equals
    Clifford(circuit), which reads ecr/dcx/iswap by *name* as Qiskit's own gates:
    QC-1's gates of those names are Qiskit's.
    """
    from qiskit import QuantumCircuit
    cliff = Clifford(QuantumCircuit(qc.num_qubits))
    for inst in qc.data:
        qs = [qc.find_bit(q).index for q in inst.qubits]
        cliff = cliff.compose(Clifford.from_operator(Operator(inst.operation)), qs)
    return cliff


def main():
    doc = json.load(open(OUT / "stabilizer.cases.json"))
    out = []
    for c in doc["large"]:
        n, gens = c["n"], c["qc1"]["generators"]
        qc = qasm3.loads(c["qasm"])
        cl = clifford_of(qc)
        if cl != Clifford(qc):
            fail(f"stabilizer {c['id']}: a gate's definition in QC-1's export differs from Qiskit's gate of that name")
        st = StabilizerState(cl)
        for g in gens:
            ev = st.expectation_value(Pauli(("-" if g[0] == "-" else "") + g[1:]))  # QC-1 writes Qiskit's labels
            if abs(ev - 1) > 1e-12:
                fail(f"stabilizer {c['id']}: <{g[:12]}…> = {ev}")
        bits = [[1 if p in "XY" else 0 for p in g[1:]] + [1 if p in "ZY" else 0 for p in g[1:]] for g in gens]
        if gf2_rank(bits) != n:
            fail(f"stabilizer {c['id']}: generators not independent")
        out.append({"id": c["id"], "n": n, "tape": c["tape"], "generators": gens})
    for c in doc["small"]:
        n, qc1 = c["n"], c["qc1"]
        qc = qasm3.loads(c["qasm"])
        outcomes = [s.get("outcome") for e in c["tape"] for s in e if s["gateId"] in ("measure", "measure_x", "measure_y", "reset") or s["gateId"].startswith("init")]
        psi, bits = run_classical(qc, n, outcomes)
        mine = np.array(qc1["state"][0::2]) + 1j * np.array(qc1["state"][1::2])
        if np.max(np.abs(psi - mine)) > 1e-9:
            fail(f"stabilizer {c['id']}: statevector reference disagrees with QC-1's statevector")
        for g in qc1["generators"]:
            P = SparsePauliOp(g[1:]).to_matrix() * (-1 if g[0] == "-" else 1)
            ev = np.real(np.vdot(psi, P @ psi))
            if abs(ev - 1) > 1e-9:
                fail(f"stabilizer {c['id']}: generator {g} has <P> = {ev} on the post-selected state")
        if (bits or [0] * n) != qc1["cbits"]:
            fail(f"stabilizer {c['id']}: classical bits {qc1['cbits']} vs {bits}")
        if qc1["notes"]:
            fail(f"stabilizer {c['id']}: the tableau re-sampled a recorded outcome: {qc1['notes']}")
        out.append({"id": c["id"], "n": n, "tape": c["tape"], "generators": qc1["generators"], "cbits": qc1["cbits"]})
    print(f"  stabilizer: {len(doc['large'])} large Clifford tapes (up to n = 200), {len(doc['small'])} measured tapes")
    write_fixture("stabilizer", "qiskit StabilizerState(Clifford(circuit)) expectation values; post-selected Statevector", out, {})


if __name__ == "__main__":
    main()
