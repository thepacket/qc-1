"""Phase 4 references: expectation & metrology.

  Pauli sums   independent regex parser → SparsePauliOp; ⟨H⟩, ⟨H²⟩ = ⟨(H@H)⟩
  QFI          4·Var(J_a), J_a = ½ Σ σ_a (SparsePauliOp)
  squeezing    Wineland ξ² = N·λmin(C⊥)/|⟨J⟩|², covariance from anticommutators
  QFI matrix   4·(½⟨{J_a,J_b}⟩ − ⟨J_a⟩⟨J_b⟩), numpy eigvalsh / det
  QGT          Richardson-extrapolated central differences of Qiskit
               statevectors (assign_parameters), error ≪ QC-1's
  Bloch paths  Qiskit Statevector at each t → reduced Bloch vectors
  sweeps       statevectors of every tape prefix (QC-1's own QASM export)
  landscape    ⟨H⟩ at each grid point via assign_parameters
"""
import json
import math
import re

import numpy as np
import qiskit.quantum_info as qi
from qiskit import qasm3
from qiskit.quantum_info import Statevector

from common import OUT, statevector, fail, r, write_fixture

TOL = 1e-9
QGT_TOL = 1e-8  # QC-1 converges adaptive Richardson differences to ~1e-9 (bug #39); this reference is fixed-step Richardson
TERM = re.compile(r"([+-]*)\s*((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)?\s*\*?\s*([IXYZ]+)")


def parse(text):
    """Independent Pauli-sum parser: signed terms 'c*PAULI' (c optional, may use an exponent)."""
    s = text.replace(" ", "")
    out, pos = [], 0
    while pos < len(s):
        m = TERM.match(s, pos)
        if not m or m.end() == pos:
            raise ValueError(f"cannot parse {text!r} at {pos}")
        sign = (-1.0) ** m.group(1).count("-")  # "+ -1*X" is −1·X
        out.append((m.group(3), sign * (float(m.group(2)) if m.group(2) else 1.0)))
        pos = m.end()
    return out


def op(terms):
    return qi.SparsePauliOp.from_list(terms)  # Qiskit's labels on Qiskit's vector


def ev(sv, o):
    return float(np.real(sv.expectation_value(o)))


def J(n, a):
    return op([("".join(a if k == q else "I" for k in range(n)), 0.5) for q in range(n)])


def spin_moments(sv, n):
    Js = [J(n, a) for a in "XYZ"]
    m = np.array([ev(sv, j) for j in Js])
    C = np.array([[0.5 * ev(sv, (Js[a] @ Js[b] + Js[b] @ Js[a]).simplify()) - m[a] * m[b] for b in range(3)] for a in range(3)])
    return m, C


def state_ref(c):
    n = c["n"]
    sv = qi.Statevector(statevector(c["qasm"]))
    out = {"hams": []}
    for text in c["hamTexts"]:
        terms = parse(text)
        H = op(terms)
        mean, second = ev(sv, H), ev(sv, (H @ H).simplify())
        out["hams"].append({"terms": [{"coefficient": co, "paulis": p} for p, co in terms],
                            "expectation": mean, "mean": mean, "second": second, "variance": max(0.0, second - mean ** 2)})
    qfis = []
    for a in "XYZ":
        Ja = J(n, a)
        e1, e2 = ev(sv, Ja), ev(sv, (Ja @ Ja).simplify())
        var = max(0.0, e2 - e1 ** 2)
        qfis.append({"expG": e1, "expG2": e2, "variance": var, "qfi": 4 * var, "qfiDensity": 4 * var / n,
                     "sql": n, "heisenberg": n * n, "witnessesEntanglement": 4 * var > n + 1e-9})
    out["qfi"] = qfis
    m, C = spin_moments(sv, n)
    L = float(np.linalg.norm(m))
    if n < 2:
        out["squeezing"] = None
    elif L < 1e-9:
        out["squeezing"] = {"mean": m.tolist(), "meanLength": L, "minPerpVariance": 0, "xiR2": None, "dB": 0, "squeezed": False}
    else:
        u = m / L
        basis = np.linalg.svd(u.reshape(1, 3))[2][1:]  # two unit vectors ⊥ u
        lam = max(0.0, float(np.linalg.eigvalsh(basis @ C @ basis.T)[0]))
        xi2 = n * lam / L ** 2
        out["squeezing"] = {"mean": m.tolist(), "meanLength": L, "minPerpVariance": lam, "xiR2": xi2,
                            "dB": -10 * math.log10(xi2) if xi2 > 0 else 0, "squeezed": xi2 < 1 - 1e-9}
    F = 4 * C
    evs = np.linalg.eigvalsh(F)
    out["multiQfi"] = {"F": F.tolist(), "eigenvalues": evs.tolist(), "maxEig": float(evs[-1]), "det": float(np.linalg.det(F))}
    p = np.abs(sv.data) ** 2
    ipr = float(min(1.0, max(1 / 2 ** n, np.sum(p ** 2))))
    pp = p[p > 0]
    out["participation"] = {"ipr": ipr, "participationRatio": 1 / ipr, "shannon": float(-np.sum(pp * np.log(pp))),
                            "renyi2": -math.log(ipr), "dim": 2 ** n, "fraction": 1 / ipr / 2 ** n}
    return out


QNAME = {"t": "t_"}


def bound(qc, scope):
    ps = {p.name: p for p in qc.parameters}
    return qc.assign_parameters({ps[QNAME.get(k, k)]: v for k, v in scope.items() if QNAME.get(k, k) in ps})


def state(qc, scope):
    return Statevector(bound(qc, scope)).data


def deriv(qc, scope, sym, h=1e-3):
    """Richardson-extrapolated central difference: error O(h⁴)."""
    def d(hh):
        a, b = dict(scope), dict(scope)
        a[sym] += hh
        b[sym] -= hh
        return (state(qc, a) - state(qc, b)) / (2 * hh)
    return (4 * d(h / 2) - d(h)) / 3


def sym_ref(c, points, grid):
    n, scope, syms = c["n"], c["scope"], c["symbols"]
    qc = qasm3.loads(c["qasm"])
    psi = state(qc, scope)
    ds = [deriv(qc, scope, s) for s in syms]
    k = len(syms)
    Q = np.array([[np.vdot(ds[i], ds[j]) - np.vdot(ds[i], psi) * np.vdot(psi, ds[j]) for j in range(k)] for i in range(k)])
    g = Q.real
    out = {"qgt": {"symbols": syms, "metric": g.tolist(), "berry": (-2 * Q.imag).tolist(),
                   "metricEigenvalues": np.linalg.eigvalsh(g).tolist(), "metricDet": float(np.linalg.det(g))}}
    if "t" in syms:
        path = [[] for _ in range(n)]
        for kk in range(points):
            sv = qi.Statevector(state(qc, {**scope, "t": 2 * math.pi * kk / (points - 1)}))
            for q in range(n):
                lab = lambda a: "".join(a if x == n - 1 - q else "I" for x in range(n))  # qubit q at position n-1-q
                path[q].append({"x": ev(sv, qi.Pauli(lab("X"))), "y": ev(sv, qi.Pauli(lab("Y"))), "z": ev(sv, qi.Pauli(lab("Z")))})
        out["bloch"] = path
    else:
        out["bloch"] = None
    prs, r2 = [], []
    for text in c["qc1"]["prefixQasm"]:
        p = np.abs(state(qasm3.loads(text), scope)) ** 2
        ipr = float(min(1.0, max(1 / 2 ** n, np.sum(p ** 2))))
        prs.append(1 / ipr)
        r2.append(-math.log(ipr))
    out["sweep"] = {"pr": prs, "renyi2": r2, "numCols": len(prs), "dim": 2 ** n}
    H = op([(t["paulis"], t["coefficient"]) for t in c["qc1"]["obs"]])
    row = []
    for i in range(grid):
        x = -math.pi + 2 * math.pi * i / (grid - 1)
        row.append(ev(qi.Statevector(state(qc, {**scope, syms[0]: x})), H))
    out["landscape"] = [row]
    return out


def compare(path, a, b, bad, tol):
    if a is None or b is None:
        if not (a is None and b is None):
            bad.append(f"{path}: {a!r} vs {b!r}")
    elif isinstance(b, dict):
        for k in b:
            compare(f"{path}.{k}", a.get(k), b[k], bad, QGT_TOL if k == "qgt" else tol)
    elif isinstance(b, list):
        if len(a) != len(b):
            bad.append(f"{path}: length {len(a)} vs {len(b)}")
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                compare(f"{path}[{i}]", x, y, bad, tol)
    elif isinstance(b, (bool, str)):
        if a != b:
            bad.append(f"{path}: {a!r} vs {b!r}")
    elif abs(float(a) - float(b)) > tol * max(1.0, abs(float(b))):
        bad.append(f"{path}: qc1={a} ref={b}")


def rounded(x):
    if isinstance(x, dict):
        return {k: rounded(v) for k, v in x.items()}
    if isinstance(x, list):
        return [rounded(v) for v in x]
    return r(x) if isinstance(x, float) else x


def main():
    bundle = json.loads((OUT / "metrology.cases.json").read_text())
    bad, fx_states, fx_sym = [], [], []
    for c in bundle["states"]:
        ref = state_ref(c)
        compare(c["id"], c["qc1"], ref, bad, TOL)
        fx_states.append({"id": c["id"], "n": c["n"], "tape": c["tape"], "expected": rounded(ref)})
    for c in bundle["symbolic"]:
        ref = sym_ref(c, bundle["pathPoints"], bundle["grid"])
        mine = {k: c["qc1"][k] for k in ("qgt", "bloch", "sweep", "landscape")}
        compare(c["id"], mine, ref, bad, TOL)
        fx_sym.append({"id": c["id"], "n": c["n"], "tape": c["tape"], "scope": c["scope"], "symbols": c["symbols"], "expected": rounded(ref)})
    if bad:
        fail(f"metrology: {len(bad)} mismatches:\n  " + "\n  ".join(bad[:40]))
    write_fixture("metrology", "independent Pauli-sum parser + qiskit SparsePauliOp expectations; numpy eigvalsh",
                  fx_states, {"abs": TOL})
    write_fixture("metrology-symbolic", "Qiskit statevectors via assign_parameters; Richardson-extrapolated derivatives for the QGT",
                  fx_sym, {"abs": TOL, "qgt": QGT_TOL})


if __name__ == "__main__":
    main()
