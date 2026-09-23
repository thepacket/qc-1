"""Phase 11 references: Compare with memory.

Qiskit's process_fidelity and average_gate_fidelity of the two exported
circuits' Operators, and state_fidelity of their statevectors, must equal
QC-1's; "same operator" must match Operator.equiv.
"""
import json

from qiskit import qasm3
from qiskit.quantum_info import Operator, Statevector, average_gate_fidelity, process_fidelity, state_fidelity

from common import OUT, fail, write_fixture


def main():
    doc = json.load(open(OUT / "verify.cases.json"))
    out = []
    for c in doc["cases"]:
        A, B = qasm3.loads(c["qc1"]["qasmA"]), qasm3.loads(c["qc1"]["qasmB"])
        UA, UB = Operator(A), Operator(B)
        s = c["qc1"]["scalars"]
        ref = {
            "process fidelity |Tr(U†V)|²/d²": process_fidelity(UB, UA),
            "average gate fidelity": average_gate_fidelity(UB, UA),
            "state fidelity |⟨ψ|φ⟩|²": state_fidelity(Statevector(A), Statevector(B)),
        }
        for k, v in ref.items():
            if abs(s[k] - v) > 1e-10:
                fail(f"verify {c['id']}: {k} QC-1 {s[k]} vs Qiskit {v}")
        if (s["same operator (up to phase)"] == "yes") != UA.equiv(UB):
            fail(f"verify {c['id']}: equivalence verdict")
        out.append({"id": c["id"], **{k: float(v) for k, v in ref.items()}})
    print(f"  verify: {len(out)} comparisons agree")
    write_fixture("verify", "qiskit process_fidelity, average_gate_fidelity, state_fidelity, Operator.equiv", out, {"abs": 1e-10})


if __name__ == "__main__":
    main()
