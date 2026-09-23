"""Algorithm blocks (CATALOG → BLOCKS): QFT, QFT†, Grover diffuser, QAOA layer.

For each block QC-1's unitary (applied to every basis state) must equal,
exactly and with the global phase:
  * QFT / QFT†: Qiskit's QFTGate(k) (inverse) on the block's qubits, taken in
    reverse order (QC-1's first block qubit is the most significant);
  * diffuser: the matrix 2|s⟩⟨s| − I on the block's qubits;
  * QAOA: Qiskit's QAOAAnsatz for cost Σ ZᵢZⱼ over the ring's edges, one
    repetition, no initial state, at the same γ, β.
Qiskit's import of QC-1's QASM export must give the same operator.
"""
import json
import warnings

import numpy as np
from qiskit import QuantumCircuit, qasm3
from qiskit.circuit.library import QAOAAnsatz, QFTGate, UnitaryGate
from qiskit.quantum_info import Operator, SparsePauliOp

from common import OUT, fail, r, write_fixture

# PauliEvolutionGate's matrix exponential nags about sparse formats; it is exact.
warnings.filterwarnings("ignore", module="scipy.sparse")


def reference(c):
    n, qs, k = c["n"], c["qubits"], len(c["qubits"])
    qc = QuantumCircuit(n)
    if c["kind"] in ("qft", "iqft"):
        g = QFTGate(k)
        qc.append(g.inverse() if c["kind"] == "iqft" else g, list(reversed(qs)))
    elif c["kind"] == "diff":
        s = np.full(2 ** k, 2 ** (-k / 2))
        qc.append(UnitaryGate(2 * np.outer(s, s) - np.eye(2 ** k)), qs)
    else:
        edges = [(0, 1)] if k == 2 else [(i, (i + 1) % k) for i in range(k)]
        cost = SparsePauliOp.from_sparse_list([("ZZ", [a, b], 1.0) for a, b in edges], num_qubits=k)
        ans = QAOAAnsatz(cost, reps=1, initial_state=QuantumCircuit(k))
        vals = {p.name: (c["beta"] if p.name.startswith("β") else c["gamma"]) for p in ans.parameters}
        ans = ans.assign_parameters({p: vals[p.name] for p in ans.parameters})
        qc.append(ans.to_gate(), qs)  # local qubit j of the ring → block qubit j (the ring is symmetric)
    return Operator(qc).reverse_qargs().data


def main():
    doc = json.load(open(OUT / "blocks.cases.json"))
    out, worst = [], 0.0
    for c in doc["cases"]:
        cols = c["qc1"]["unitary"]
        mine = np.array([np.array(col[0::2]) + 1j * np.array(col[1::2]) for col in cols]).T
        ref = reference(c)
        err = float(np.max(np.abs(mine - ref)))
        worst = max(worst, err)
        if err > 1e-10:
            fail(f"blocks {c['id']}: QC-1 differs from the reference by {err:.2e}")
        exp = Operator(qasm3.loads(c["qc1"]["qasm"])).reverse_qargs().data
        if np.max(np.abs(exp - ref)) > 1e-10:
            fail(f"blocks {c['id']}: Qiskit's import of the export differs by {np.max(np.abs(exp - ref)):.2e}")
        out.append({"id": c["id"], "n": c["n"], "unitary": {"re": [[r(z.real) for z in row] for row in ref.T], "im": [[r(z.imag) for z in row] for row in ref.T]}})
    print(f"  blocks: {len(out)} blocks, worst difference {worst:.2e}")
    write_fixture("blocks", "qiskit QFTGate / QAOAAnsatz Operators; 2|s><s| - I; Qiskit import of the export", out, {"abs": 1e-10})


if __name__ == "__main__":
    main()
