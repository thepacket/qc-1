"""Entanglement / density-matrix references (Phase 1).

Each quantity comes from Qiskit's quantum_info where one exists
(partial_trace, purity, entropy, mutual_information, negativity,
concurrence, Pauli expectation values), otherwise from numpy on the same
reduced density matrices. The Page formula is also checked against a
Monte-Carlo average over Haar-random states.

Endianness: QC-1 vectors are big-endian. Building qi.Statevector from that
vector directly makes Qiskit qubit j = QC-1 qubit n-1-j, so tracing out
QC-1 qubits T means tracing Qiskit qubits {n-1-t}; the remaining matrix
then matches QC-1's row order when the kept set is sorted.
"""
import json

import numpy as np
import qiskit.quantum_info as qi

from common import OUT, be_statevector, fail, qc1_state, r, write_fixture

TOL = 1e-9
# Concurrence takes square roots of eigenvalues that are ~0 for most states,
# so any implementation (Qiskit's included) is only good to ~sqrt(eps) there.
TOLS = {"concurrence": 1e-7}


def ptrace(sv, n, kept):
    traced = [n - 1 - q for q in range(n) if q not in kept]
    return qi.partial_trace(sv, traced) if traced else qi.DensityMatrix(sv)


def entropy_bits(evals):
    ev = evals[evals > 1e-12]
    return float(-np.sum(ev * np.log2(ev)))


def renyi(evals, a):
    ev = evals[evals > 1e-12]
    if abs(a - 1) < 1e-9:
        return float(-np.sum(ev * np.log2(ev)))
    if a == 0:
        return float(np.log2(len(ev)))
    return float(np.log2(np.sum(ev ** a)) / (1 - a))


def pauli_label(p):
    # The big-endian vector is wrapped as qi.Statevector directly, so Qiskit
    # qubit j is QC-1 qubit n-1-j, and a Qiskit label's k-th character (from
    # the left) is Qiskit qubit n-1-k = QC-1 qubit k. No reversal needed.
    return p


def reference(case):
    n = case["n"]
    psi = be_statevector(case["qasm"])
    if np.max(np.abs(psi - qc1_state_from_tape(case))) > TOL:
        fail(f"{case['id']}: statevector mismatch before analysis")
    sv = qi.Statevector(psi)
    q = case["qc1"]
    out = {"rdm": []}
    for row in q["rdm"]:
        kept = row["kept"]
        dm = ptrace(sv, n, kept)
        ev = np.sort(np.linalg.eigvalsh(dm.data))[::-1]
        out["rdm"].append({
            "kept": kept,
            "rho": {"re": dm.data.real.tolist(), "im": dm.data.imag.tolist()},
            "purity": float(qi.purity(dm).real),
            "entropy": float(qi.entropy(dm, base=2)),
            "eigenvalues": np.clip(ev, 0, None).tolist(),
        })
    single = [float(qi.entropy(ptrace(sv, n, [i]), base=2)) for i in range(n)]
    mi = np.zeros((n, n))
    neg = np.zeros((n, n))
    conc = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            dm2 = ptrace(sv, n, [i, j])  # Qiskit subsystem 0 = QC-1 qubit j
            mi[i, j] = mi[j, i] = max(0.0, float(qi.mutual_information(dm2, base=2)))
            nv = float(qi.negativity(dm2, [0]))
            neg[i, j] = neg[j, i] = max(0.0, float(np.log2(2 * nv + 1)))
            conc[i, j] = conc[j, i] = float(qi.concurrence(dm2))
    out["mi"] = mi.tolist()
    out["single"] = single
    prof = []
    for k in range(n - 1):
        prof.append(float(qi.entropy(ptrace(sv, n, list(range(k + 1))), base=2)))
    out["profile"] = prof
    half = list(range(n // 2))
    ev = np.sort(np.clip(np.linalg.eigvalsh(ptrace(sv, n, half).data), 0, None))[::-1]
    out["schmidt"] = {"spectrum": ev.tolist(), "entropy": entropy_bits(ev), "rank": int(np.sum(ev > 1e-9))}
    alphas = q["renyi"]["alphas"]
    out["renyi"] = {
        "alphas": alphas,
        "entropies": [renyi(ev, a) for a in alphas],
        "min": float(-np.log2(max(ev.max(), 1e-12))),
        "hartley": float(np.log2(max(int(np.sum(ev > 1e-9)), 1))),
    }
    out["negativity"] = neg.tolist()
    out["concurrence"] = conc.tolist()
    probes = q_probes(n)
    out["paulis"] = [float(sv.expectation_value(qi.Pauli(pauli_label(p))).real) for p in probes]
    if n <= 3:
        # QC-1 indexes all 4^n strings in base 4, digit q (LSB first) = qubit q, I/X/Y/Z = 0..3.
        allp = []
        for idx in range(4 ** n):
            s, x = "", idx
            for _ in range(n):
                s += "IXYZ"[x & 3]
                x >>= 2
            allp.append(float(sv.expectation_value(qi.Pauli(pauli_label(s))).real))
        out["allPaulis"] = allp
    else:
        out["allPaulis"] = None
    return out


def q_probes(n):  # mirrors pauliProbes() in validation/cases/groups/entanglement.ts
    P = "IXYZ"
    out = ["Z" * n, "X" * n, "Y" * n]
    for k in range(6):
        out.append("".join(P[(q * 7 + k * 3 + q * k) % 4] for q in range(n)))
    return out


def qc1_state_from_tape(case):
    # The dump doesn't carry QC-1's statevector for this group; the gates/random
    # fixtures already pin the simulator, so compare Qiskit with itself here and
    # rely on the analysis comparison below. (Kept as a hook for clarity.)
    return be_statevector(case["qasm"])


def compare(path, a, b, bad, tol=TOL):
    """Recursive numeric comparison; appends mismatching paths to `bad`."""
    if b is None or a is None:
        if a is not b:
            bad.append(f"{path}: {a!r} vs {b!r}")
        return
    if isinstance(b, dict):
        for k in b:
            compare(f"{path}.{k}", a.get(k), b[k], bad, TOLS.get(k, tol))
    elif isinstance(b, list):
        if len(a) != len(b):
            bad.append(f"{path}: length {len(a)} vs {len(b)}")
            return
        for i, (x, y) in enumerate(zip(a, b)):
            compare(f"{path}[{i}]", x, y, bad, tol)
    elif isinstance(b, (int, float)):
        if not (abs(float(a) - float(b)) <= tol * max(1.0, abs(float(b)))):
            bad.append(f"{path}: qc1={a} ref={b}")


def rounded(x):
    if isinstance(x, dict):
        return {k: rounded(v) for k, v in x.items()}
    if isinstance(x, list):
        return [rounded(v) for v in x]
    if isinstance(x, float):
        return r(x)
    return x


def page_bits(mA, mB):
    a, b = min(mA, mB), max(mA, mB)
    dA, dB = 2 ** a, 2 ** b
    # Page (1993), d_A <= d_B: sum 1/k for k = d_B+1 .. d_A*d_B, minus (d_A-1)/(2 d_B).
    nats = sum(1.0 / k for k in range(dB + 1, dA * dB + 1)) - (dA - 1) / (2 * dB)
    return nats / np.log(2)


def page_monte_carlo(mA, mB, samples=4000, seed=7):
    rng = np.random.default_rng(seed)
    n = mA + mB
    s = []
    for _ in range(samples):
        v = rng.normal(size=2 ** n) + 1j * rng.normal(size=2 ** n)
        v /= np.linalg.norm(v)
        m = v.reshape(2 ** mA, 2 ** mB)
        ev = np.linalg.svd(m, compute_uv=False) ** 2
        s.append(entropy_bits(ev))
    return float(np.mean(s)), float(np.std(s) / np.sqrt(samples))


def main():
    with open(OUT / "entanglement.cases.json") as f:
        bundle = json.load(f)
    fixtures, bad = [], []
    for c in bundle["cases"]:
        ref = reference(c)
        compare(c["id"], c["qc1"], ref, bad)
        fixtures.append({"id": c["id"], "n": c["n"], "tape": c["tape"], "expected": rounded(ref)})
    # Page formula: exact closed form, plus a Monte-Carlo sanity check of the formula itself.
    pairs = bundle["page"]["pairs"]
    page_ref = [page_bits(a, b) for a, b in pairs]
    for (a, b), mine, ref in zip(pairs, bundle["page"]["qc1"], page_ref):
        if abs(mine - ref) > TOL:
            bad.append(f"page({a},{b}): qc1={mine} ref={ref}")
        if a + b <= 5:
            mc, se = page_monte_carlo(a, b)
            if abs(mc - ref) > 5 * se:
                bad.append(f"page({a},{b}) formula vs Haar Monte Carlo: {ref} vs {mc}±{se}")
    if bad:
        fail(f"entanglement: {len(bad)} mismatches:\n  " + "\n  ".join(bad[:40]))
    write_fixture("entanglement",
                  "qiskit.quantum_info (partial_trace, purity, entropy, mutual_information, negativity, "
                  "concurrence, Pauli expectation) + numpy eigvalsh; Page formula + Haar Monte Carlo",
                  fixtures, {"abs": TOL, **TOLS})
    write_fixture("page", "closed form (Page 1993) checked against a Haar Monte-Carlo average",
                  [{"id": f"page{a}{b}", "n": a + b, "tape": [], "expected": r(v)} for (a, b), v in zip(pairs, page_ref)],
                  {"abs": TOL})


if __name__ == "__main__":
    main()
