"""Typed states and matrices (CATALOG → STATE…, MATRIX…).

Each case's text is also written as a numpy expression, independently (or,
for random unitaries, parsed here from the same decimal text). QC-1's gate
must equal the matrix exactly, global phase included, on the given qubits
(the first is the most significant); a state gate must take |0…0⟩ to the
normalised state exactly. Qiskit's import of QC-1's QASM export (custom gate
definitions, u_arb as U + gphase) must give the same operator / state.
"""
import json
import re

import numpy as np
from qiskit import QuantumCircuit, qasm3
from qiskit.circuit.library import UnitaryGate
from qiskit.quantum_info import Operator, Statevector

from common import OUT, cvec, fail, write_fixture


def from_text(text):
    rows = [[complex(x.strip().replace("i", "j")) for x in row.split(",")] for row in text.split(";")]
    return np.array(rows)


def main():
    doc = json.load(open(OUT / "typed.cases.json"))
    out, worst = [], 0.0
    for c in doc["cases"]:
        ref = from_text(c["text"]) if c["py"] == "text" else eval(c["py"], {"np": np})
        n, qs = c["n"], c["qubits"]
        qc = QuantumCircuit(n)
        if c["kind"] == "matrix":
            qc.append(UnitaryGate(ref), list(qs))  # QC-1 reads a typed matrix as Qiskit does: the first qubit is the least significant
            want = Operator(qc).data
            cols = c["qc1"]["cols"]
            mine = np.array([np.array(col[0::2]) + 1j * np.array(col[1::2]) for col in cols]).T
            got = Operator(qasm3.loads(c["qc1"]["qasm"])).data
        else:
            ref = ref / np.linalg.norm(ref)
            qc.initialize(ref, list(qs))  # Qiskit's own reading of the target on those qubits
            want = Statevector(qc).data
            col = c["qc1"]["cols"][0]
            mine = np.array(col[0::2]) + 1j * np.array(col[1::2])
            got = Statevector(qasm3.loads(c["qc1"]["qasm"])).data
        err = max(float(np.max(np.abs(mine - want))), float(np.max(np.abs(got - want))))
        worst = max(worst, err)
        if err > 1e-10:
            fail(f"typed {c['id']}: QC-1 or its export differs from the typed {c['kind']} by {err:.2e}")
        out.append({"id": c["id"], "want": cvec(want.T.flatten() if c["kind"] == "matrix" else want)})
    print(f"  typed: {len(out)} matrices and states, worst difference {worst:.2e}")
    write_fixture("typed", "the typed matrix/state (numpy, written independently); Qiskit import of the export", out, {"abs": 1e-10})


if __name__ == "__main__":
    main()
