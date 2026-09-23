"""Phase 5a references: operator & spectrum.

  unitary          qiskit Operator (reordered to big-endian)
  PTM              definition R_ij = Tr(P_i U P_j U†)/2ⁿ (numpy, QC-1 labels)
  operator ent.    SVD of U reshaped (A_out A_in)×(B_out B_in)
  Floquet          numpy eigvals of U → sorted phases
  H spectrum       SparsePauliOp.to_matrix → eigvalsh (label char q = qubit q = MSB first)
  DOS/levels/SFF   same definitions on the numpy spectrum
  Krylov           numpy Lanczos (full re-orthogonalisation); C(t) from expm(−iHt)
  ensembles        numpy eigh; per-level weights (basis-independent) always,
                   per-eigenvector quantities only for non-degenerate H
  work (TPM)       energy projectors Π: P = ‖Π_m U Π_n|0⟩‖²
  Berry / Chern    Qiskit statevectors on the same loop / grid (discrete Wilson
                   loop, Fukui–Hatsugai–Suzuki); spin-½ checked against −Ω/2
"""
import json
import math

import numpy as np
import qiskit.quantum_info as qi
from qiskit import qasm3
from qiskit.quantum_info import Operator, Statevector
from scipy.linalg import expm

from common import OUT, be_statevector, fail, r, write_fixture

TOL = 1e-9
PAULI = {"I": np.eye(2), "X": np.array([[0, 1], [1, 0]]), "Y": np.array([[0, -1j], [1j, 0]]), "Z": np.diag([1, -1])}


def label_mat(s):
    m = np.array([[1.0 + 0j]])
    for ch in s:
        m = np.kron(m, PAULI[ch])
    return m


def be_unitary(qasm):
    return Operator(qasm3.loads(qasm)).reverse_qargs().data


def ham(text):
    import re
    s = text.replace(" ", "")
    terms, pos = [], 0
    pat = re.compile(r"([+-]*)((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)?\*?([IXYZ]+)")
    while pos < len(s):
        m = pat.match(s, pos)
        terms.append((m.group(3), (-1.0) ** m.group(1).count("-") * (float(m.group(2)) if m.group(2) else 1.0)))
        pos = m.end()
    return qi.SparsePauliOp.from_list(terms).to_matrix()


def circ_ref(c):
    n, U = c["n"], be_unitary(c["qasm"])
    d = 2 ** n
    out = {"unitary": {"re": U.real.flatten().tolist(), "im": U.imag.flatten().tolist()}}
    if n <= 2:
        labels = ["".join("IXYZ"[(k >> (2 * (n - 1 - q))) & 3] for q in range(n)) for k in range(4 ** n)]
        P = [label_mat(l) for l in labels]
        out["ptm"] = [[float(np.real(np.trace(Pi @ U @ Pj @ U.conj().T))) / d for Pj in P] for Pi in P]
    else:
        out["ptm"] = None
    if n >= 2:
        a = n // 2
        dA, dB = 2 ** a, 2 ** (n - a)
        T = U.reshape(dA, dB, dA, dB).transpose(0, 2, 1, 3).reshape(dA * dA, dB * dB)
        lam = np.linalg.svd(T, compute_uv=False) ** 2 / d
        lam = np.sort(lam[lam > 1e-12])[::-1]
        out["opEnt"] = {"spectrum": lam.tolist(), "entropy": float(-np.sum(lam * np.log2(lam))), "cutA": a, "numQubits": n}
    else:
        out["opEnt"] = None
    th = np.angle(np.linalg.eigvals(U))
    th = np.sort(np.where(th <= -math.pi + 1e-12, math.pi, th))  # (−π, π]
    gaps = np.append(np.diff(th), 2 * math.pi - (th[-1] - th[0])) if len(th) > 1 else np.diff(th)  # circular
    mg = gaps.mean() if len(gaps) else 1.0
    ratios = [min(x, y) / max(x, y) for x, y in zip(gaps[:-1], gaps[1:]) if max(x, y) > 1e-15]
    out["floquet"] = {"quasiEnergies": th.tolist(), "spacings": (gaps / (mg or 1)).tolist(), "meanR": float(np.mean(ratios)) if ratios else 0.0}
    return out


def level_stats(E, bins=20):
    E = np.sort(E)
    D = len(E)
    span = (E[-1] - E[0]) or 1
    tol = 1e-9 * span + 1e-12
    sp = np.diff(E)
    ratios = [0.0 if max(a, b) < tol else min(a, b) / max(a, b) for a, b in zip(sp[:-1], sp[1:])]
    hist = np.zeros(bins)
    for x in ratios:
        hist[min(bins - 1, max(0, int(math.floor(x * bins))))] += 1
    hist /= len(ratios) / bins
    return {"spacings": sp.tolist(), "ratios": ratios, "meanRatio": float(np.mean(ratios)), "hist": hist.tolist(),
            "bins": bins, "degenerateFraction": float(np.sum(sp < tol) / len(sp))}


def dos(E, bins=24):
    lo, hi = float(np.min(E)), float(np.max(E))
    span = hi - lo
    w = span / bins if span > 1e-12 else 1
    counts = np.zeros(bins)
    for e in E:
        counts[min(bins - 1, max(0, int(math.floor((e - lo) / w)) if span > 1e-12 else 0))] += 1
    return {"centers": [lo + (b + 0.5) * w for b in range(bins)], "counts": counts.tolist(), "binWidth": w, "eMin": lo, "eMax": hi, "total": len(E)}


def sff(E, samples):
    Es = np.sort(E)
    D = len(E)
    span = (Es[-1] - Es[0]) or 1
    tH = 2 * math.pi / (span / (D - 1))
    ts = np.exp(np.linspace(math.log(tH / 1000), math.log(tH * 20), samples))
    vals = [abs(np.sum(np.exp(-1j * E * t))) ** 2 / D ** 2 for t in ts]
    tol = 1e-9 * span + 1e-12
    deg, i = 0, 0
    while i < D:
        j = i + 1
        while j < D and Es[j] - Es[i] < tol:
            j += 1
        deg += (j - i) ** 2
        i = j
    return {"t": ts.tolist(), "sff": [float(v) for v in vals], "plateau": deg / D ** 2, "heisenbergTime": tH}


def lanczos(H, psi):
    K = [psi / np.linalg.norm(psi)]
    a, b = [], []
    for step in range(len(psi)):
        w = H @ K[step]
        a.append(float(np.real(np.vdot(K[step], w))))
        for v in K:  # full re-orthogonalisation (covers the a/b recursion terms)
            w = w - np.vdot(v, w) * v
        bn = float(np.linalg.norm(w))
        if bn < 1e-9:
            break
        b.append(bn)
        K.append(w / bn)
    return a, b, K[: len(a)]


def krylov(H, psi, samples):
    a, b, K = lanczos(H, psi)
    T = np.diag(a) + np.diag(b[: len(a) - 1], 1) + np.diag(b[: len(a) - 1], -1)
    th = np.linalg.eigvalsh(T)
    rng_ = (th.max() - th.min()) or 1
    tmax = 12 * math.pi / rng_
    times = [tmax * s / (samples - 1) for s in range(samples)]
    psi0 = psi / np.linalg.norm(psi)
    C = []
    for t in times:
        pt = expm(-1j * H * t) @ psi0
        C.append(float(sum(k * abs(np.vdot(Kk, pt)) ** 2 for k, Kk in enumerate(K))))
    return {"a": a, "b": b, "krylovDim": len(a), "times": times, "complexity": C}


def per_level(E, w):
    out = []
    for e, x in zip(E, w):
        if out and abs(out[-1]["energy"] - e) < 1e-8:
            out[-1]["weight"] += x
        else:
            out.append({"energy": float(e), "weight": float(x)})
    return out


def ham_ref(h, state_qasm, state_n):
    n = h["n"]
    Hm = ham(h["text"])
    E, V = np.linalg.eigh(Hm)
    psi = be_statevector(state_qasm)
    U = be_unitary(state_qasm)
    gap = float(E[1] - E[0]) if len(E) > 1 else 0.0
    pops = np.abs(V.conj().T @ psi) ** 2
    pops /= pops.sum()
    out = {
        "spectrum": {"energies": E.tolist(), "ground": float(E[0]), "gap": gap, "numQubits": n},
        "dos": dos(E), "levels": level_stats(E), "sff": sff(E, 24),
        "krylov": krylov(Hm, psi, 24),
        "ensemble": {"perLevel": per_level(E, pops), "meanEnergy": float(np.sum(pops * E)),
                     "energySpread": float(math.sqrt(max(0.0, np.sum(pops * E * E) - np.sum(pops * E) ** 2)))},
    }
    # Two-point measurement with energy projectors.
    lv = []
    for k, e in enumerate(E):
        if lv and abs(E[lv[-1][0]] - e) < 1e-9 * max(1, np.max(np.abs(E))):
            lv[-1].append(k)
        else:
            lv.append([k])
    zero = np.zeros(2 ** n)
    zero[0] = 1
    Pi = [V[:, idx] @ V[:, idx].conj().T for idx in lv]
    pairs = []
    for ni, Pn in enumerate(Pi):
        v = U @ (Pn @ zero)
        for mi, Pm in enumerate(Pi):
            t = float(np.linalg.norm(Pm @ v) ** 2)
            if t >= 1e-15:
                pairs.append((E[lv[mi][0]] - E[lv[ni][0]], t))
    ws = [p[0] for p in pairs]
    wmin, wmax = min(ws), max(ws)
    span = wmax - wmin
    bw = span / 24 if span > 1e-12 else 1
    probs = np.zeros(24)
    for w, p in pairs:
        probs[min(23, max(0, int(math.floor((w - wmin) / bw)) if span > 1e-12 else 0))] += p
    tot = probs.sum() or 1
    mean = sum(w * p / tot for w, p in pairs)
    out["work"] = {"works": [wmin + (b + 0.5) * bw for b in range(24)], "probs": (probs / tot).tolist(), "meanWork": mean,
                   "variance": sum((w - mean) ** 2 * p / tot for w, p in pairs), "binWidth": bw}
    if not h["degenerate"]:
        O = label_mat("Z" + "I" * (n - 1))
        Om = V.conj().T @ O @ V
        dim = 2 ** n
        stride = max(1, dim * dim // 4000)
        off, seen, tot2, cnt = [], 0, 0.0, 0
        for m in range(dim):
            for k in range(dim):
                if k == m:
                    continue
                v2 = float(abs(Om[m, k]) ** 2)
                tot2 += v2
                cnt += 1
                if seen % stride == 0:
                    off.append({"omega": float(E[m] - E[k]), "mag2": v2})
                seen += 1
        out["eth"] = {"diag": [{"energy": float(E[m]), "value": float(np.real(Om[m, m]))} for m in range(dim)],
                      "meanOffDiag": tot2 / cnt, "offDiag": off}
        out["ensembleFull"] = {"populations": pops.tolist(), "ipr": float(np.sum(pops ** 2)), "effectiveDim": float(1 / np.sum(pops ** 2))}
        half = n // 2
        ents = []
        for k in range(dim):
            s = np.linalg.svd(V[:, k].reshape(2 ** half, 2 ** (n - half)), compute_uv=False) ** 2
            s = s[s > 1e-12]
            ents.append(float(-np.sum(s * np.log2(s))))
        out["eigEnt"] = {"energies": E.tolist(), "entropies": ents, "maxEntropy": min(half, n - half), "numQubits": n}
        xs = [e for e, p in zip(E, pops) if p > 1e-9]
        ys = [math.log(p) for p in pops if p > 1e-9]
        slope, icpt = np.polyfit(xs, ys, 1)
        pred = icpt + slope * np.array(xs)
        ss_tot = float(np.sum((np.array(ys) - np.mean(ys)) ** 2))
        out["effTemp"] = {"beta": float(-slope), "r2": max(0.0, 1 - float(np.sum((np.array(ys) - pred) ** 2)) / ss_tot) if ss_tot > 1e-12 else 1.0,
                          "intercept": float(icpt)}
    return out


QN = {"t": "t_"}


def geo_state(qc, scope):
    ps = {p.name: p for p in qc.parameters}
    return Statevector(qc.assign_parameters({ps[QN.get(k, k)]: v for k, v in scope.items() if QN.get(k, k) in ps})).reverse_qargs().data


def geom_ref(g):
    qc = qasm3.loads(g["qasm"])
    loop = g["qc1"]["berry"]["loop"]  # vertices from QC-1's definition of the loop; recomputed below too
    c0, c1, rad, steps = g["scope"]["theta"], g["scope"]["phi"], 0.5, 8
    corners = [(c0 - rad, c1 - rad), (c0 + rad, c1 - rad), (c0 + rad, c1 + rad), (c0 - rad, c1 + rad)]
    pts = []
    for sd in range(4):
        (ax, ay), (bx, by) = corners[sd], corners[(sd + 1) % 4]
        for s in range(steps):
            f = s / steps
            pts.append((ax + (bx - ax) * f, ay + (by - ay) * f))
    states = [geo_state(qc, {**g["scope"], "theta": a, "phi": b}) for a, b in pts]
    prod = 1 + 0j
    for k in range(len(states)):
        prod *= np.vdot(states[k], states[(k + 1) % len(states)])
    gamma = -math.atan2(prod.imag, prod.real)
    gamma = (gamma + math.pi) % (2 * math.pi) - math.pi
    if gamma <= -math.pi:
        gamma += 2 * math.pi
    N = 6
    grid = [[geo_state(qc, {**g["scope"], "theta": 2 * math.pi * i / N, "phi": 2 * math.pi * j / N}) for j in range(N)] for i in range(N)]
    link = lambda a, b: (lambda z: z / (abs(z) or 1))(np.vdot(a, b))
    curv = [[0.0] * N for _ in range(N)]
    tot = 0.0
    for i in range(N):
        for j in range(N):
            ip, jp = (i + 1) % N, (j + 1) % N
            z = link(grid[i][j], grid[ip][j]) * link(grid[ip][j], grid[ip][jp]) * np.conj(link(grid[i][jp], grid[ip][jp])) * np.conj(link(grid[i][j], grid[i][jp]))
            curv[i][j] = float(np.angle(z))
            tot += curv[i][j]
    return {"berry": {"gamma": gamma, "overlapMagnitude": float(abs(prod)), "loop": [list(p) for p in pts]},
            "chern": {"chern": tot / (2 * math.pi), "curvature": curv}}


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
    b = json.loads((OUT / "spectrum.cases.json").read_text())
    bad, fc, fh, fg = [], [], [], []
    for c in b["circuits"]:
        ref = circ_ref(c)
        compare(c["id"], c["qc1"], ref, bad)
        fc.append({"id": c["id"], "n": c["n"], "tape": c["tape"], "expected": rounded(ref)})
    for h in b["hams"]:
        st = next(c for c in b["circuits"] if c["id"] == h["stateId"])
        ref = ham_ref(h, st["qasm"], st["n"])
        compare(h["id"], h["qc1"], ref, bad)
        fh.append({"id": h["id"], "n": h["n"], "tape": st["tape"], "text": h["text"], "degenerate": h["degenerate"], "stateId": h["stateId"], "expected": rounded(ref)})
    for g in b["geom"]:
        ref = geom_ref(g)
        compare(g["id"], g["qc1"], ref, bad)
        if g["id"] == "spin":  # analytic: γ = −Ω/2 for the (θ, φ) rectangle; a coarse loop approximates it
            c0, rad = g["scope"]["theta"], 0.5
            omega = 2 * rad * (math.cos(c0 - rad) - math.cos(c0 + rad))
            if abs(ref["berry"]["gamma"] - (-omega / 2)) > 0.02:
                bad.append(f"spin Berry phase {ref['berry']['gamma']} vs analytic −Ω/2 = {-omega / 2}")
        fg.append({"id": g["id"], "n": g["n"], "tape": g["tape"], "scope": g["scope"], "expected": rounded(ref)})
    if bad:
        fail(f"spectrum: {len(bad)} mismatches:\n  " + "\n  ".join(bad[:40]))
    write_fixture("spectrum-circuits", "qiskit Operator; numpy PTM/SVD/eigvals from definitions", fc, {"abs": TOL})
    write_fixture("spectrum-hamiltonians", "SparsePauliOp matrices; numpy eigh/Lanczos/expm; energy projectors", fh, {"abs": TOL})
    write_fixture("spectrum-geometry", "qiskit statevectors on the Wilson loop / FHS grid; spin-½ vs −Ω/2", fg, {"abs": TOL})


if __name__ == "__main__":
    main()
