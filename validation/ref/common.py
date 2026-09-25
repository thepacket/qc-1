"""Shared helpers for QC-1 reference generators.

Conventions: QC-1 uses Qiskit's bit order (qubit q = bit q of a basis index,
q0 rightmost in kets, bitstrings and Pauli labels), so Qiskit's vectors,
operators, density matrices, labels and counts compare with QC-1's directly:
no reversal anywhere.
"""
import json
import pathlib
import sys

import numpy as np
import qiskit
import qiskit_qasm3_import
import scipy
from qiskit import qasm3
from qiskit.quantum_info import Statevector

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "validation" / "out"
FIXTURES = ROOT / "test" / "fixtures"

VERSIONS = {
    "qiskit": qiskit.__version__,
    "qiskit_qasm3_import": qiskit_qasm3_import.__version__,
    "numpy": np.__version__,
    "scipy": scipy.__version__,
}


def load_cases(group):
    with open(OUT / f"{group}.cases.json") as f:
        return json.load(f)["cases"]


def qc1_state(case):
    s = case["state"]
    return np.array(s[0::2]) + 1j * np.array(s[1::2])


def statevector(qasm_text):
    return Statevector(qasm3.loads(qasm_text)).data


def r(x, digits=12):
    """Round for stable, compact fixtures (and -0.0 → 0.0)."""
    return float(round(float(x), digits)) + 0.0


def cvec(v):
    return {"re": [r(z.real) for z in v], "im": [r(z.imag) for z in v]}


def write_fixture(group, reference, cases, tol):
    FIXTURES.mkdir(parents=True, exist_ok=True)
    doc = {
        "meta": {"group": group, "reference": reference, "versions": VERSIONS, "tol": tol},
        "cases": cases,
    }
    path = FIXTURES / f"{group}.json"
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
        f.write("\n")
    print(f"  wrote {path.relative_to(ROOT)} ({len(cases)} cases)")


def fail(msg):
    print(f"VALIDATION FAILED: {msg}", file=sys.stderr)
    sys.exit(1)
