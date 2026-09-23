"""Phase 2 references: remaining state-only analyses.

Each quantity is recomputed from its definition with Qiskit quantum_info
and numpy/scipy, never by translating the ported code:
  entropies / partial traces / partial transposes / concurrence ... Qiskit
  Pauli expectations (ZZ, CHSH T-matrix, magic, characteristic fn) . Qiskit
  discord: scipy multi-start minimisation over projective measurements
  three-tangle: Cayley hyperdeterminant (independent of the CKW route)
  Wigner: standard Wootters phase-point operators, as explicit matrices
  Majorana stars: numpy.roots of the Majorana polynomial

The big-endian QC-1 vector is wrapped as qi.Statevector directly, so Qiskit
qubit j is QC-1 qubit n-1-j and Pauli labels need no reversal.
"""
import json
import math

import numpy as np
import qiskit.quantum_info as qi
from scipy.optimize import minimize

from common import OUT, be_statevector, fail, r, write_fixture

TOL = 1e-9
# Square roots of near-zero eigenvalues: good only to ~sqrt(eps) anywhere.
LOOSE = {"cab2": 1e-7, "cac2": 1e-7, "tau3": 1e-7}


def qk(n, q):  # QC-1 qubit -> Qiskit qubit index for the directly-wrapped vector
    return n - 1 - q


def ptrace(sv, n, kept):
    traced = [qk(n, q) for q in range(n) if q not in kept]
    return qi.partial_trace(sv, traced) if traced else qi.DensityMatrix(sv)


def S(dm):
    return float(qi.entropy(dm, base=2))


def ev_desc(dm):
    return np.sort(np.clip(np.linalg.eigvalsh(dm.data), 0, None))[::-1]


def pauli(sv, s):
    return float(sv.expectation_value(qi.Pauli(s)).real)


def pstr(n, ops):  # {qubit: 'X'} -> label with QC-1 qubit q at position q
    return "".join(ops.get(q, "I") for q in range(n))


def half(n):
    return list(range(max(1, n // 2)))


def shannon(p):
    p = np.asarray(p)
    p = p[p > 1e-12]
    return float(-np.sum(p * np.log2(p)))


# ── individual references ─────────────────────────────────────────────
def counting(psi, n, region):
    probs = np.abs(psi) ** 2
    p = np.zeros(len(region) + 1)
    for idx, pr in enumerate(probs):
        if pr < 1e-18:
            continue
        m = sum((idx >> (n - 1 - q)) & 1 for q in region)
        p[m] += pr
    mean = float(np.dot(np.arange(len(p)), p))
    var = float(np.dot((np.arange(len(p)) - mean) ** 2, p))
    return {"p": p.tolist(), "mean": mean, "variance": var, "size": len(region)}


def multifractal(psi, n):
    p = np.abs(psi) ** 2
    p = p[p > 1e-14]
    logD = n * math.log(2)
    qs = [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8]

    def D(q):
        if q == 0:
            return math.log(len(p)) / logD
        if abs(q - 1) < 1e-9:
            return float(-np.sum(p * np.log(p)) / logD)
        return float(-math.log(np.sum(p ** q)) / ((q - 1) * logD))

    return {"qs": qs, "dq": [D(q) for q in qs], "d0": D(0), "d1": D(1), "d2": D(2),
            "dInf": float(-math.log(p.max()) / logD), "numQubits": n}


def symmetry(sv, psi, n):
    probs = np.abs(psi) ** 2
    w = np.zeros(n + 1)
    for i, pr in enumerate(probs):
        w[bin(i).count("1")] += pr
    even, odd = float(w[0::2].sum()), float(w[1::2].sum())
    occupied = int(np.sum(w > 1e-9))
    return {"weightSectors": w.tolist(), "parityEven": even, "parityOdd": odd,
            "parityExpectation": pauli(sv, "Z" * n), "numOccupiedSectors": occupied,
            "numberConserved": occupied == 1,
            "parityConserved": ((even > 1e-9) + (odd > 1e-9)) == 1}


def coherence_pure(psi, n):
    a = np.abs(psi)
    rho = np.outer(psi, psi.conj())
    l1 = float(np.sum(np.abs(rho)) - np.sum(a ** 2))
    return {"cL1": l1, "cRel": shannon(a ** 2), "cL1Max": 2 ** n - 1, "cRelMax": n, "stateEntropy": 0}


def coherence_mixed(dm, k):
    m = dm.data
    l1 = float(np.sum(np.abs(m)) - np.sum(np.abs(np.diag(m))))
    s = S(dm)
    return {"cL1": l1, "cRel": max(0.0, shannon(np.real(np.diag(m))) - s),
            "cL1Max": 2 ** k - 1, "cRelMax": k, "stateEntropy": s}


def anticoncentration(psi, n, bins=24, ymax=6):
    D = 2 ** n
    p = np.abs(psi) ** 2
    y = D * p
    w = ymax / bins
    b = np.minimum(np.floor(y / w + 1e-9).astype(int), bins - 1)  # edges: see bug #7
    counts = np.bincount(b, minlength=bins)
    centers = (np.arange(bins) + 0.5) * w
    return {"centers": centers.tolist(), "density": (counts / D / w).tolist(),
            "ptCurve": np.exp(-centers).tolist(), "collisionRatio": float(D * np.sum(p ** 2)), "numQubits": n}


def zz(sv, n):
    z = [pauli(sv, pstr(n, {q: "Z"})) for q in range(n)]
    conn = np.zeros((n, n))
    for i in range(n):
        for j in range(i, n):
            zij = 1.0 if i == j else pauli(sv, pstr(n, {i: "Z", j: "Z"}))
            conn[i, j] = conn[j, i] = zij - z[i] * z[j]
    return {"conn": conn.tolist(), "z": z}


def structure(conn, n, samples=9):
    C = np.array(conn)
    ks = [math.pi * m / (samples - 1) for m in range(samples)]
    d = np.subtract.outer(np.arange(n), np.arange(n))
    return {"k": ks, "s": [float(np.sum(np.cos(k * d) * C) / n) for k in ks]}


def cut_spectrum(sv, n, k):  # eigenvalues of rho_[0..k]
    return ev_desc(ptrace(sv, n, list(range(k + 1))))


def schmidt_gap(sv, n):
    out = []
    for k in range(n - 1):
        ev = cut_spectrum(sv, n, k)
        out.append(max(0.0, float(ev[0] - (ev[1] if len(ev) > 1 else 0))))
    return out


def mps(psi, n, target=0.01):
    chi, max_chi, worst, worst_err = [], 0, 0, []
    for k in range(n - 1):
        m = psi.reshape(2 ** (k + 1), 2 ** (n - k - 1))
        lam = np.sort(np.linalg.svd(m, compute_uv=False) ** 2)[::-1]
        errs = np.maximum(0, 1 - np.cumsum(lam))
        c = int(np.argmax(errs <= target)) + 1
        chi.append(c)
        if c > max_chi:
            max_chi, worst, worst_err = c, k, errs.tolist()
    return {"chi": chi, "maxChi": max_chi, "worstCut": worst, "truncError": worst_err, "numQubits": n}


def chsh(sv, n):
    s = np.zeros((n, n))
    for a in range(n):
        for b in range(a + 1, n):
            T = np.array([[pauli(sv, pstr(n, {a: i, b: j})) for j in "XYZ"] for i in "XYZ"])
            sv_ = np.sort(np.linalg.svd(T, compute_uv=False))[::-1]
            s[a, b] = s[b, a] = 2 * math.sqrt(sv_[0] ** 2 + sv_[1] ** 2)
    return s.tolist()


def discord_pair(rho_ab):
    """D(A|B) with B measured, minimising over projective measurements (true optimum)."""
    rho = rho_ab.reshape(2, 2, 2, 2)  # (a, b, a', b')
    rhoA = np.einsum("ibjb->ij", rho)
    rhoB = np.einsum("aiaj->ij", rho)
    ent = lambda m: shannon(np.linalg.eigvalsh(m))
    I = ent(rhoA) + ent(rhoB) - ent(rho_ab)

    def cond(x):
        th, ph = x
        v = np.array([math.cos(th / 2), math.sin(th / 2) * np.exp(1j * ph)])
        total = 0.0
        for P in (np.outer(v, v.conj()), np.eye(2) - np.outer(v, v.conj())):
            m = np.einsum("bc,acdb->ad", P, np.einsum("abcd,de->abce", rho, P))
            p = float(np.real(np.trace(m)))
            if p > 1e-12:
                total += p * ent(m / p)
        return total

    best = min(minimize(cond, x0, method="Nelder-Mead", options={"xatol": 1e-12, "fatol": 1e-14, "maxiter": 4000}).fun
               for x0 in [(t, f) for t in np.linspace(0.1, 3.0, 5) for f in np.linspace(0, 6, 5)])
    return max(0.0, I - (ent(rhoA) - best))


def discord(sv, n):
    d = np.zeros((n, n))
    for a in range(n):
        for b in range(n):
            if a != b:
                dm = ptrace(sv, n, sorted([a, b])).data
                if a > b:  # put A first (QC-1's rho index = 2·a_bit + b_bit)
                    dm = dm.reshape(2, 2, 2, 2).transpose(1, 0, 3, 2).reshape(4, 4)
                d[a, b] = discord_pair(dm)
    return d.tolist()


def ent_ham(sv, n):
    ev = ev_desc(ptrace(sv, n, half(n)))
    lv = sorted(-math.log(x) for x in ev if x > 1e-12)
    return {"levels": lv, "entropy": shannon(ev), "rank": int(np.sum(ev > 1e-9))}


def contour(sv, n, size):
    cum = [0.0] + [S(ptrace(sv, n, list(range(k)))) for k in range(1, size + 1)]
    return {"contour": [cum[j + 1] - cum[j] for j in range(size)], "total": cum[size], "regionSize": size}


def neg_spectrum(sv, n, A):
    ev = np.sort(np.linalg.eigvalsh(qi.DensityMatrix(sv).partial_transpose([qk(n, q) for q in A]).data))
    neg = float(-np.sum(ev[ev < 0]))
    return ev, {"eigenvalues": ev.tolist(), "negativity": neg, "logNegativity": math.log2(2 * neg + 1)}


def pt_moments(ev):
    mom = [float(np.sum(ev ** m)) for m in range(1, 7)]
    return {"moments": mom, "p2": mom[1], "p3": mom[2], "entangledByP3": mom[2] < mom[1] ** 2 - 1e-9,
            "logNegativity": math.log2(2 * float(-np.sum(ev[ev < 0])) + 1)}


def corr_length(conn, n):
    C = np.array(conn)
    rr = list(range(1, n))
    g = [float(np.mean([abs(C[i, i + d]) for i in range(n - d)])) for d in rr]
    xs = [d for d, gg in zip(rr, g) if gg > 1e-6]
    ys = [math.log(gg) for gg in g if gg > 1e-6]
    xi, icpt = None, (ys[0] if ys else 0.0)  # None = infinite correlation length
    if len(xs) >= 2:
        slope, icpt = np.polyfit(xs, ys, 1)
        xi = float(-1 / slope) if slope < -1e-9 else None
    return {"r": rr, "g": g, "xi": xi, "intercept": float(icpt), "fitPoints": len(xs), "numQubits": n}


def ent_stats(sv, n):
    ev = ev_desc(ptrace(sv, n, half(n)))
    xi = sorted(-math.log(x) for x in ev if x > 1e-12)
    if len(xi) < 3:
        return None
    gaps = np.diff(xi)
    ratios = [min(a, b) / max(a, b) for a, b in zip(gaps[:-1], gaps[1:]) if max(a, b) > 1e-15]
    return {"ratios": ratios, "meanR": float(np.mean(ratios)) if ratios else 0.0, "levels": len(xi)}


def hyperdet_tangle(psi):
    a = psi.reshape(2, 2, 2)
    d1 = a[0,0,0]**2*a[1,1,1]**2 + a[0,0,1]**2*a[1,1,0]**2 + a[0,1,0]**2*a[1,0,1]**2 + a[1,0,0]**2*a[0,1,1]**2
    d2 = (a[0,0,0]*a[1,1,1]*a[0,1,1]*a[1,0,0] + a[0,0,0]*a[1,1,1]*a[1,0,1]*a[0,1,0] + a[0,0,0]*a[1,1,1]*a[1,1,0]*a[0,0,1]
          + a[0,1,1]*a[1,0,0]*a[1,0,1]*a[0,1,0] + a[0,1,1]*a[1,0,0]*a[1,1,0]*a[0,0,1] + a[1,0,1]*a[0,1,0]*a[1,1,0]*a[0,0,1])
    d3 = a[0,0,0]*a[1,1,0]*a[1,0,1]*a[0,1,1] + a[1,1,1]*a[0,0,1]*a[0,1,0]*a[1,0,0]
    return float(4 * abs(d1 - 2 * d2 + 4 * d3))


def three_tangle(sv, psi, n):
    out = []
    tau = hyperdet_tangle(psi)
    for a in range(3):
        b, c = (a + 1) % 3, (a + 2) % 3
        one = 2 * (1 - float(qi.purity(ptrace(sv, n, [a])).real))
        cab2 = float(qi.concurrence(ptrace(sv, n, sorted([a, b])))) ** 2
        cac2 = float(qi.concurrence(ptrace(sv, n, sorted([a, c])))) ** 2
        if abs(max(0.0, one - cab2 - cac2) - tau) > 1e-6:
            fail(f"CKW monogamy check failed for the reference itself ({one - cab2 - cac2} vs {tau})")
        out.append({"focal": a, "oneTangle": one, "cab2": cab2, "cac2": cac2, "tau3": tau})
    return out


def tripartite(sv, n, a, b, c):
    s = lambda qs: S(ptrace(sv, n, sorted(qs)))
    sA, sB, sC = s([a]), s([b]), s([c])
    iAB = max(0.0, sA + sB - s([a, b]))
    iAC = max(0.0, sA + sC - s([a, c]))
    iABC = max(0.0, sA + s([b, c]) - s([a, b, c]))
    return {"sA": sA, "sB": sB, "sC": sC, "iAB": iAB, "iAC": iAC, "iABC": iABC, "i3": iAB + iAC - iABC}


I2 = np.eye(2)
X = np.array([[0, 1], [1, 0]])
Y = np.array([[0, -1j], [1j, 0]])
Z = np.diag([1, -1])


def wigner(psi, n):
    """Wootters: A(q,p) = ½[I + (−1)^q Z + (−1)^p X + (−1)^{q+p} Y]; W = Tr(ρ A)/2ⁿ.
    Grid: row bit q (Z sign) and col bit p (X sign) of qubit k sit at bit k."""
    rho = np.outer(psi, psi.conj())
    dim = 2 ** n
    W = np.zeros((dim, dim))
    for row in range(dim):
        for col in range(dim):
            A = np.array([[1.0]])
            for k in range(n):  # qubit 0 is the first tensor factor (MSB)
                q, p = (row >> k) & 1, (col >> k) & 1
                A = np.kron(A, 0.5 * (I2 + (-1) ** q * Z + (-1) ** p * X + (-1) ** (q + p) * Y))
            W[row, col] = float(np.real(np.trace(rho @ A))) / dim
    neg = float(-W[W < 0].sum())
    return {"W": W.tolist(), "dim": dim, "negativity": neg, "minW": float(min(0.0, W.min()))}


def char_function(sv, n):
    dim = 2 ** n
    mag = np.zeros((dim, dim))
    for u in range(dim):
        for v in range(dim):
            lab = "".join("IZXY"[((u >> q) & 1) * 2 + ((v >> q) & 1)] for q in range(n))
            mag[u, v] = abs(pauli(sv, lab))
    return {"mag": mag.tolist(), "dim": dim, "total": float(mag.sum())}


def magic_all(sv, n):
    labels, weights = [], []
    for idx in range(4 ** n):
        s, x = "", idx
        for _ in range(n):
            s += "IXYZ"[x & 3]
            x >>= 2
        labels.append(s)
        weights.append(sum(ch != "I" for ch in s))
    e = np.array([pauli(sv, s) for s in labels])
    xi = e ** 2 / 2 ** n
    wd = np.zeros(n + 1)
    for w, x in zip(weights, xi):
        wd[w] += x
    m2 = max(0.0, -math.log2(np.sum(xi ** 2)) - n)
    alphas = [0.5, 1, 1.5, 2, 3, 4]

    def M(a):
        if abs(a - 1) < 1e-9:
            z = xi[xi > 1e-15]
            return max(0.0, float(-np.sum(z * np.log2(z))) - n)
        return max(0.0, float(math.log2(np.sum(xi ** a)) / (1 - a)) - n)

    return {"m2": m2, "weightDist": wd.tolist()}, {"alphas": alphas, "m": [M(a) for a in alphas], "m2": m2}


def majorana(psi, n):
    a = np.zeros(n + 1, dtype=complex)
    for x, amp in enumerate(psi):
        a[bin(x).count("1")] += amp
    a /= np.sqrt([math.comb(n, k) for k in range(n + 1)])
    coeff = [(-1) ** k * math.sqrt(math.comb(n, k)) * a[k] for k in range(n + 1)]  # z^(n-k), descending
    lead = next((i for i, c in enumerate(coeff) if abs(c) > 1e-12), n)
    roots = np.roots(coeff[lead:]) if lead < n else np.array([])
    stars = [{"theta": 2 * math.atan(abs(z)), "phi": math.atan2(z.imag, z.real) % (2 * math.pi)} for z in roots]
    stars += [{"theta": math.pi, "phi": 0.0}] * lead  # roots at infinity -> south pole
    return {"symmetricWeight": float(np.sum(np.abs(a) ** 2)), "stars": stars}


def husimi(psi, n, nT, nP):
    Q = np.zeros((nT, nP))
    for it in range(nT):
        th = math.pi * it / (nT - 1)
        for ip in range(nP):
            ph = 2 * math.pi * ip / nP
            one = np.array([math.cos(th / 2), math.sin(th / 2) * np.exp(1j * ph)])
            coh = np.array([1.0 + 0j])
            for _ in range(n):
                coh = np.kron(coh, one)
            Q[it, ip] = abs(np.vdot(coh, psi)) ** 2
    return Q.tolist()


def reference(c, husimi_grid):
    n = c["n"]
    psi = be_statevector(c["qasm"])
    sv = qi.Statevector(psi)
    q = c["qc1"]
    out = {"counting": counting(psi, n, half(n)), "multifractal": multifractal(psi, n),
           "symmetry": symmetry(sv, psi, n), "coherence": coherence_pure(psi, n),
           "anticoncentration": anticoncentration(psi, n) if n >= 2 else None}
    if n >= 2:
        z = zz(sv, n)
        out["zz"] = z
        out["structure"] = structure(z["conn"], n)
        out["schmidtGap"] = schmidt_gap(sv, n)
        out["mps"] = mps(psi, n)
        per = [S(ptrace(sv, n, [i])) for i in range(n)]
        out["total"] = {"perQubit": per, "total": sum(per), "numQubits": n}
        out["chsh"] = chsh(sv, n)
        out["discord"] = discord(sv, n)
        out["entHam"] = ent_ham(sv, n)
        out["contour"] = contour(sv, n, max(1, n - 1))
        sub = [0, n - 1] if n >= 3 else [0]
        out["coherenceMixed"] = {"kept": sub, **coherence_mixed(ptrace(sv, n, sub), len(sub))}
        if n <= 6:
            ev, ns = neg_spectrum(sv, n, half(n))
            out["negSpectrum"] = ns
            out["ptMoments"] = pt_moments(ev)
    if n >= 3:
        out["corrLength"] = corr_length(out["zz"]["conn"], n)
        out["entStats"] = ent_stats(sv, n)
    if n == 3:
        out["threeTangle"] = three_tangle(sv, psi, n)
    if n >= 4:
        out["tripartite"] = tripartite(sv, n, 0, 1, n - 1)
    if n <= 4:
        out["wigner"] = wigner(psi, n)
        out["charFunction"] = char_function(sv, n)
    if n <= 6:
        out["magic"], out["magicSpectrum"] = magic_all(sv, n)
        out["majorana"] = majorana(psi, n)
    if n <= 7:
        out["husimi"] = husimi(psi, n, husimi_grid["nTheta"], husimi_grid["nPhi"])
    return out


# ── comparison ────────────────────────────────────────────────────────
def unit(s):
    return np.array([math.sin(s["theta"]) * math.cos(s["phi"]), math.sin(s["theta"]) * math.sin(s["phi"]), math.cos(s["theta"])])


def star_tol(stars):
    v = [unit(s) for s in stars]
    sep = min((np.linalg.norm(a - b) for i, a in enumerate(v) for b in v[i + 1:]), default=2.0)
    # Simple roots are well-conditioned; a k-fold root is only good to ~eps^(1/k).
    return 1e-8 if sep > 0.05 else 5e-3


def match_stars(mine, ref):
    """Largest distance after greedily pairing each reference star with the nearest unused QC-1 star."""
    left = [unit(s) for s in mine]
    worst = 0.0
    for s in ref:
        u = unit(s)
        d = [np.linalg.norm(u - w) for w in left]
        k = int(np.argmin(d))
        worst = max(worst, d[k])
        left.pop(k)
    return worst


def compare(path, a, b, bad, tol=TOL):
    if a is None or b is None:
        if not (a is None and b is None):
            bad.append(f"{path}: {a!r} vs {b!r}")
        return
    if isinstance(b, dict):
        for k in b:
            if k == "stars":
                w, t = match_stars(a[k], b[k]), star_tol(b[k])
                if w > t:
                    bad.append(f"{path}.stars: worst star distance {w:.2e} > {t}")
                continue
            compare(f"{path}.{k}", a.get(k), b[k], bad, LOOSE.get(k, tol))
    elif isinstance(b, list):
        if len(a) != len(b):
            bad.append(f"{path}: length {len(a)} vs {len(b)}")
            return
        for i, (x, y) in enumerate(zip(a, b)):
            compare(f"{path}[{i}]", x, y, bad, tol)
    elif isinstance(b, bool):
        if a != b:
            bad.append(f"{path}: {a} vs {b}")
    elif isinstance(b, (int, float)):
        if abs(float(a) - float(b)) > tol * max(1.0, abs(float(b))):
            bad.append(f"{path}: qc1={a} ref={b}")


def rounded(x):
    if isinstance(x, dict):
        return {k: rounded(v) for k, v in x.items()}
    if isinstance(x, list):
        return [rounded(v) for v in x]
    if isinstance(x, float):
        return r(x)
    return x


def main():
    bundle = json.loads((OUT / "state2.cases.json").read_text())
    fixtures, bad, discord_gap = [], [], []
    for c in bundle["cases"]:
        ref = reference(c, bundle["husimi"])
        mine = dict(c["qc1"])
        # Discord: QC-1 minimises on a grid, so it can only over-estimate. Track by how much.
        if "discord" in ref:
            gap = np.array(mine.pop("discord")) - np.array(ref["discord"])
            if gap.min() < -1e-9:
                bad.append(f"{c['id']}.discord: below the true optimum by {-gap.min():.2e}")
            discord_gap.append((float(gap.max()), c["id"]))
        compare(c["id"], mine, {k: v for k, v in ref.items() if k != "discord"}, bad)
        fixtures.append({"id": c["id"], "n": c["n"], "tape": c["tape"], "expected": rounded(ref)})
    worst = max(discord_gap)
    print(f"  discord: worst over-estimate by the QC-1 grid = {worst[0]:.2e} ({worst[1]})")
    if bad:
        fail(f"state2: {len(bad)} mismatches:\n  " + "\n  ".join(bad[:40]))
    write_fixture("state2",
                  "qiskit.quantum_info + numpy/scipy from definitions (see validation/ref/g_state2.py)",
                  fixtures, {"abs": TOL, **LOOSE, "discord": 1e-6})


if __name__ == "__main__":
    main()
