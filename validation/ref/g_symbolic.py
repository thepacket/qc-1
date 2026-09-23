"""Symbolic tapes: QC-1's QASM export declares every symbol as `input float`
(t as t_, since `t` names the T gate); Qiskit imports them as Parameters.
At each point the reference is Statevector(assign_parameters(...)), compared
with both a fresh QC-1 register and one re-scoped in place (slider replay)."""
import json

import numpy as np
from qiskit import qasm3
from qiskit.quantum_info import Statevector

from common import OUT, cvec, fail, write_fixture

TOL = 1e-9
QASM_NAME = {"t": "t_"}


def state(v):
    return np.array(v[0::2]) + 1j * np.array(v[1::2])


def main():
    bundle = json.loads((OUT / "symbolic.cases.json").read_text())
    points = bundle["points"]
    fixtures, bad = [], []
    for c in bundle["cases"]:
        qc = qasm3.loads(c["qasm"])
        params = {p.name: p for p in qc.parameters}
        expected = []
        for k, (pt, mine) in enumerate(zip(points, c["qc1"])):
            binding = {params[QASM_NAME.get(name, name)]: val for name, val in pt.items() if QASM_NAME.get(name, name) in params}
            ref = Statevector(qc.assign_parameters(binding)).reverse_qargs().data
            for how in ("fresh", "replayed"):
                err = float(np.max(np.abs(ref - state(mine[how]))))
                if err > TOL:
                    bad.append(f"{c['id']} point {k} ({how}): |Δ| = {err:.2e}")
            expected.append(cvec(ref))
        fixtures.append({"id": c["id"], "n": c["n"], "tape": c["tape"], "qasm": c["qasm"], "expected": expected})
    if bad:
        fail(f"symbolic: {len(bad)} mismatches:\n  " + "\n  ".join(bad[:30]))
    write_fixture("symbolic", "qiskit.qasm3.loads (input float → Parameter) → assign_parameters → Statevector",
                  fixtures, {"abs": TOL})
    (OUT / "symbolic.points.json").write_text(json.dumps(points))


if __name__ == "__main__":
    main()
