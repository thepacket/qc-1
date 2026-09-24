"""Phase 5b references: dynamics over the t clock and along the tape.

Every quantity comes from Qiskit statevectors / Operators of QC-1's QASM
export with the symbols bound (t as t_), recomputed from its definition:
  ⟨Z⟩(t), periodic-sample DFT (numpy rfft), Loschmidt |⟨ψ0|ψt⟩|², imbalance,
  half-cut entropy and its max slope, log-negativity via the FULL partial
  transpose (qiskit negativity) rather than the Schmidt shortcut, OTOC
  ⟨0|W(t)VW(t)V|0⟩ with W(t) = U†WU, operator-weight distribution from
  Tr(P W(t))/2ⁿ, infinite-T autocorrelation Tr(Z(t)Z)/2ⁿ, and prefix sweeps.
"""
import json
import math

import numpy as np
import qiskit.quantum_info as qi
from qiskit import qasm3
from qiskit.quantum_info import Operator, Statevector

from common import OUT, fail, r, write_fixture

TOL = 1e-9
QN = {"t": "t_"}
PAULI = {"I": np.eye(2), "X": np.array([[0, 1], [1, 0]]), "Y": np.array([[0, -1j], [1j, 0]]), "Z": np.diag([1.0, -1.0])}


def bind(qc, scope):
    ps = {p.name: p for p in qc.parameters}
    return qc.assign_parameters({ps[QN.get(k, k)]: v for k, v in scope.items() if QN.get(k, k) in ps})


def state(qc, scope):
    return Statevector(bind(qc, scope)).reverse_qargs().data


def unitary(qc, scope):
    return Operator(bind(qc, scope)).reverse_qargs().data


def op1(n, q, p):
    m = np.array([[1.0 + 0j]])
    for k in range(n):
        m = np.kron(m, PAULI[p if k == q else "I"])
    return m


def zexp(psi, n, q):
    return float(np.real(np.vdot(psi, op1(n, q, "Z") @ psi)))


def S_half(psi, n, A):
    ev = np.linalg.eigvalsh(qi.partial_trace(qi.Statevector(psi), [n - 1 - q for q in range(n) if q not in A]).data)
    ev = ev[ev > 1e-12]
    return float(-np.sum(ev * np.log2(ev)))


def ts_closed(P):
    return [2 * math.pi * k / (P - 1) for k in range(P)]


def otoc_curve(qc, scope, n, w, v, P):
    C, reF = [], []
    W, V = op1(n, w, "Z"), op1(n, v, "Z")
    zero = np.zeros(2 ** n)
    zero[0] = 1
    for t in ts_closed(P):
        U = unitary(qc, {**scope, "t": t})
        Wt = U.conj().T @ W @ U
        F = np.real((zero @ (Wt @ V @ Wt @ V) @ zero))
        reF.append(float(F))
        C.append(float(1 - F))
    return C, reF


def crossing(ts, C, th=0.5):
    for k in range(1, len(C)):
        if C[k] >= th and C[k - 1] < th:
            f = (th - C[k - 1]) / ((C[k] - C[k - 1]) or 1)
            return ts[k - 1] + f * (ts[k] - ts[k - 1])
    return ts[0] if C[0] >= th else None


def linfit(xs, ys):
    if len(xs) < 2:
        return None, None
    b, a = np.polyfit(xs, ys, 1)
    return float(b), float(a)


def reference(c, P):
    n, sc = c["n"], c["scope"]
    qc = qasm3.loads(c["qasm"])
    tsc = ts_closed(P["sweep"])
    states = [state(qc, {**sc, "t": t}) for t in tsc]
    out = {"tsweep": [[zexp(p, n, q) for p in states] for q in range(n)]}
    per = [state(qc, {**sc, "t": 2 * math.pi * k / P["spec"]}) for k in range(P["spec"])]
    spec = []
    for q in range(n):
        f = np.fft.rfft([zexp(p, n, q) for p in per])
        spec.append([abs(x) * (1 / P["spec"] if m == 0 or 2 * m == P["spec"] else 2 / P["spec"]) for m, x in enumerate(f)])  # DC and Nyquist: 1/N
    out["spectrum"] = spec
    psi0 = state(qc, {**sc, "t": 0})
    L = [float(abs(np.vdot(psi0, p)) ** 2) for p in states]
    out["loschmidt"] = {"L": L, "rate": [(-math.log(l) / n) if l > 1e-12 else 30 / n for l in L]}
    imb = [sum((1 if q % 2 == 0 else -1) * zexp(p, n, q) for q in range(n)) / n for p in states]
    out["imbalance"] = {"imbalance": imb, "plateau": float(np.mean(np.abs(imb[P["sweep"] // 2:])))}
    Z0 = op1(n, 0, "Z")
    Cs = []
    for t in tsc:
        U = unitary(qc, {**sc, "t": t})
        Cs.append(float(np.real(np.trace(U.conj().T @ Z0 @ U @ Z0))) / 2 ** n)
    f = np.fft.rfft(Cs[:-1])  # one uniform period: t_k, k = 0 … P−2
    Pp = P["sweep"] - 1
    out["autocorr"] = {"C": Cs, "spectrum": [abs(x) * (1 / Pp if m == 0 or 2 * m == Pp else 2 / Pp) for m, x in enumerate(f)]}
    prefix = [state(qasm3.loads(text), sc) for text in c["qc1"]["prefixQasm"]]
    out["spacetime"] = [[zexp(p, n, q) for p in prefix] for q in range(n)]
    if n <= 4:
        rows = []
        for t in ts_closed(P["opw"]):
            U = unitary(qc, {**sc, "t": t})
            Wt = U.conj().T @ op1(n, 0, "Z") @ U
            row = np.zeros(n + 1)
            for idx in range(4 ** n):
                lab, x = "", idx
                for _ in range(n):
                    lab += "IXYZ"[x & 3]
                    x >>= 2
                m = np.array([[1.0 + 0j]])
                for ch in lab:
                    m = np.kron(m, PAULI[ch])
                row[sum(ch != "I" for ch in lab)] += abs(np.trace(m @ Wt) / 2 ** n) ** 2
            rows.append(row.tolist())
        out["opweight"] = rows
    if n >= 2:
        half = list(range(max(1, n // 2)))
        ent = [S_half(p, n, half) for p in states]
        vel, at = 0.0, 0.0
        for k in range(1, len(ent)):
            slope = (ent[k] - ent[k - 1]) / (tsc[k] - tsc[k - 1])
            if slope > vel:
                vel, at = slope, tsc[k]
        out["velocity"] = {"entropy": ent, "velocity": vel, "velocityAt": at, "maxEntropy": max(ent + [0])}
        out["negdyn"] = [float(math.log2(2 * qi.negativity(qi.Statevector(p), [n - 1 - q for q in half]) + 1)) for p in states]
        C, reF = otoc_curve(qc, sc, n, 0, n - 1, P["otoc"])
        out["otoc"] = {"C": C, "reF": reF}
        grid = []
        for q in range(n):
            grid.append([0.0] * P["cone"] if q == 0 else otoc_curve(qc, sc, n, 0, q, P["cone"])[0])
        out["lightcone"] = grid
        series = []
        tso = ts_closed(P["otoc"])
        for v in range(1, n):
            Cv = otoc_curve(qc, sc, n, 0, v, P["otoc"])[0]
            series.append({"distance": v, "vQubit": v, "C": Cv, "arrival": crossing(tso, Cv)})
        pts = [(s_["arrival"], s_["distance"]) for s_ in series if s_["arrival"] is not None]
        vB, icpt = linfit([p[0] for p in pts], [p[1] for p in pts]) if len(pts) >= 2 else (None, None)
        out["butterfly"] = {"series": series, "vB": vB, "intercept": icpt if icpt is not None else 0}
        cmax = max(C)
        lo, hi = max(1e-3, 0.02 * cmax), 0.7 * cmax
        lnC = [None] * len(C)  # the first contiguous rising run inside (lo, hi)
        k0 = next((k for k, x in enumerate(C) if lo < x < hi), None)
        if k0 is not None:
            k = k0
            while k < len(C) and lo < C[k] < hi and (k == k0 or C[k] > C[k - 1]):
                lnC[k] = math.log(C[k])
                k += 1
        xs = [t for t, y in zip(tso, lnC) if y is not None]
        ys = [y for y in lnC if y is not None]
        lam, icp = linfit(xs, ys) if len(xs) >= 3 else (None, None)
        r2 = None
        if lam is not None:
            ss_tot = sum((y - np.mean(ys)) ** 2 for y in ys)
            r2 = max(0.0, 1 - sum((y - icp - lam * x) ** 2 for x, y in zip(xs, ys)) / ss_tot) if ss_tot > 1e-12 else 1.0
        out["lyapunov"] = {"C": C, "lnC": lnC, "lyapunov": lam, "intercept": icp, "r2": r2}
        out["spacetimeEntropy"] = [[S_half(p, n, [q]) for p in prefix] for q in range(n)]
        aq = list(range(min(5, math.ceil(n / 2))))
        asym = []
        for p in prefix:
            rho = qi.partial_trace(qi.Statevector(p), [n - 1 - q for q in range(n) if q not in aq]).data
            d = rho.shape[0]
            proj = np.array([[rho[i, j] if bin(i).count("1") == bin(j).count("1") else 0 for j in range(d)] for i in range(d)])
            ent_ = lambda m: (lambda e: float(-np.sum(e * np.log2(e))))(np.clip(np.linalg.eigvalsh(m), 0, None)[np.linalg.eigvalsh(m) > 1e-12])
            asym.append(max(0.0, ent_(proj) - ent_(rho)))
        out["asymmetry"] = asym
    return out


def compare(path, a, b, bad, tol=TOL):
    if a is None or b is None:
        if not (a is None and b is None):
            bad.append(f"{path}: {a!r} vs {b!r}")
    elif isinstance(b, dict):
        for k in b:
            compare(f"{path}.{k}", a.get(k), b[k], bad, tol)
    elif isinstance(b, list):
        if len(a) != len(b):
            bad.append(f"{path}: length {len(a)} vs {len(b)}")
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                compare(f"{path}[{i}]", x, y, bad, tol)
    elif abs(float(a) - float(b)) > tol * max(1.0, abs(float(b))):
        bad.append(f"{path}: qc1={a} ref={b}")


def rounded(x):
    if isinstance(x, dict):
        return {k: rounded(v) for k, v in x.items()}
    if isinstance(x, list):
        return [rounded(v) for v in x]
    return r(x) if isinstance(x, float) else x


def main():
    b = json.loads((OUT / "dynamics.cases.json").read_text())
    bad, fx = [], []
    for c in b["cases"]:
        ref = reference(c, b["points"])
        mine = {k: v for k, v in c["qc1"].items() if k != "prefixQasm"}
        compare(c["id"], mine, ref, bad)
        if c["id"] == "rabi":  # analytic: ⟨Z⟩(t) = cos t, spectrum peak 1 at bin 1
            for t, z in zip(ts_closed(b["points"]["sweep"]), ref["tsweep"][0]):
                if abs(z - math.cos(t)) > 1e-12:
                    bad.append(f"rabi reference ⟨Z⟩({t}) = {z} ≠ cos t")
            if abs(ref["spectrum"][0][1] - 1) > 1e-12:
                bad.append("rabi spectrum bin 1 ≠ 1")
        fx.append({"id": c["id"], "n": c["n"], "tape": c["tape"], "scope": c["scope"], "expected": rounded(ref)})
    if bad:
        fail(f"dynamics: {len(bad)} mismatches:\n  " + "\n  ".join(bad[:40]))
    write_fixture("dynamics", "qiskit Statevector/Operator at each t (input float t_) + numpy definitions", fx, {"abs": TOL})


if __name__ == "__main__":
    main()
