"""Statevector + QASM 3 export references.

Qiskit imports each exported program; its statevector (reordered to
big-endian) is the expected value. The generator refuses to write a
fixture if QC-1's own statevector disagrees: that is a bug to fix, not a
reference to record.
"""
import numpy as np

from common import be_statevector, cvec, fail, load_cases, qc1_state, write_fixture

TOL = 1e-9


def run(group):
    out, bad = [], []
    for c in load_cases(group):
        ref = be_statevector(c["qasm"])
        err = float(np.max(np.abs(ref - qc1_state(c))))
        if err > TOL:
            bad.append(f"{c['id']} (|Δ|={err:.2e})")
        out.append({"id": c["id"], "n": c["n"], "tape": c["tape"], **({"gates": c["gates"]} if c.get("gates") else {}), "qasm": c["qasm"], "expected": cvec(ref)})
    if bad:
        fail(f"{group}: QC-1 disagrees with Qiskit on {len(bad)} cases: {', '.join(bad[:10])}")
    write_fixture(group, "qiskit.qasm3.loads → Statevector.reverse_qargs()", out, {"abs": TOL})


if __name__ == "__main__":
    for g in ("gates", "random-tapes"):
        run(g)
