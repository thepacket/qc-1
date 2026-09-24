"""Phase 9 references: benchmarking protocols on the noise model.

Every circuit QC-1 drew is re-run from its QASM export through Aer's errors
applied as Kraus maps to a DensityMatrix (g_noise.density):
  * RB / interleaved RB / unitarity: survival (purity) per length exact;
    A·pᵐ + B fitted with scipy.optimize.curve_fit (B free);
  * T1/T2 under pure amplitude / phase damping: the fits recover the closed
    forms T1 = −1/ln(1−γ), T2 = −2/ln(1−γ) (per gate);
  * QV heavy-output and XEB linear fidelity per circuit, mirror success;
  * process tomography: R_ij = Tr(P_i Λ(P_j))/2ⁿ of the (noisy) channel;
  * repetition code: the binomial tail.
"""
import json
from math import comb

import numpy as np
from qiskit import qasm3
from qiskit.quantum_info import DensityMatrix, Kraus, Operator, SparsePauliOp, Statevector
from scipy.optimize import curve_fit

from common import OUT, fail, write_fixture
from g_noise import density, errors_after

TOL = 1e-10


def close(a, b, what, tol=TOL):
    a, b = np.asarray(a, float), np.asarray(b, float)
    if a.shape != b.shape or np.max(np.abs(a - b)) > tol:
        fail(f"bench {what}: QC-1 {b} vs reference {a}")


def fit(xs, ys):
    f = lambda x, A, p, B: A * p ** x + B
    (A, p, B), _ = curve_fit(f, np.array(xs, float), np.array(ys, float), p0=[0.5, 0.95, 0.5], maxfev=20000)
    return A, p, B


def rho_of(text, n, m):
    return density(qasm3.loads(text), n, m)


def channel(qc, n, m, X):
    """Apply the noisy circuit to an arbitrary n-qubit matrix X (little-endian, as Qiskit)."""
    r = DensityMatrix(X, validate=False) if "validate" in DensityMatrix.__init__.__code__.co_varnames else DensityMatrix(X)
    for inst in qc.data:
        qs = [qc.find_bit(q).index for q in inst.qubits]
        r = r.evolve(inst.operation, qs)
        for eq, err in errors_after(m, inst, qs):
            r = r.evolve(Kraus(err), eq)
    return r.data


def main():
    c = json.load(open(OUT / "bench.cases.json"))["qc1"]
    M = c["models"]
    m = M["global"]
    # RB
    rb = c["rb"]
    surv = [np.mean([rho_of(t, 1, m)[0, 0].real for t in ts]) for ts in rb["qasm"]]
    close(surv, rb["survival"], "RB survival")
    A, p, B = fit(rb["lengths"], surv)
    close([A, p, B], [rb["A"], rb["p"], rb["B"]], "RB fit", 1e-6)
    rbi = c["rbi"]
    surv_i = [np.mean([rho_of(t, 1, m)[0, 0].real for t in ts]) for ts in rbi["qasm"]]
    close(surv_i, rbi["survival"], "interleaved RB survival")
    close(fit(rb["lengths"], surv_i)[1], rbi["p"], "interleaved RB p", 1e-6)
    # Interleaved X where only X is noisy (depolarizing λ = 0.2): Aer on the exported sequences, and the
    # closed form ½ + ½(1 − λ)ᵐ (the Clifford twirl of depolarizing is depolarizing; every other gate is ideal).
    rbx = c["rbx"]
    surv_x = [np.mean([rho_of(t, 1, M["xgate"])[0, 0].real for t in ts]) for ts in rbx["qasm"]]
    close(surv_x, rbx["survival"], "interleaved X survival (per-gate noise)")
    close([0.5 + 0.5 * 0.8 ** L for L in rbx["lengths"]], rbx["survival"], "interleaved X closed form", 1e-12)
    close(fit(rbx["lengths"], surv_x)[1], rbx["p"], "interleaved X p", 1e-6)
    # Unitarity
    u = c["unitarity"]
    pur = []
    for ts in u["qasm"]:
        vals = []
        for t in ts:
            r = rho_of(t, 1, m)
            vals.append(2 * np.real(np.trace(r @ r)) - 1)
        pur.append(np.mean(vals))
    close(pur, u["purity"], "unitarity purity")
    Au, uu, Bu = fit([l - 1 for l in u["lengths"]], pur)
    close([Au, uu, Bu], [u["A"], u["u"], u["B"]], "unitarity fit", 1e-6)
    # QV
    for w in c["qv"]:
        n = w["width"]
        for text, hop in zip(w["qasm"], w["hops"]):
            ideal = np.abs(Statevector(qasm3.loads(text)).reverse_qargs().data) ** 2
            med = np.median(ideal)
            noisy = np.real(np.diag(rho_of(text, n, m)))
            close(np.sum(noisy[ideal > med]), hop, f"QV width {n} heavy output")
    # XEB
    x = c["xeb"]
    n = x["n"]
    for cs, vals in zip(x["qasm"], x["perCircuit"]):
        for text, v in zip(cs, vals):
            ideal = np.abs(Statevector(qasm3.loads(text)).reverse_qargs().data) ** 2
            noisy = np.real(np.diag(rho_of(text, n, m)))
            D = 1 << n
            den = np.sum((ideal - 1 / D) ** 2)
            ref = None if den <= 1e-9 else np.sum((noisy - 1 / D) * (ideal - 1 / D)) / den
            if (ref is None) != (v is None) or (ref is not None and abs(ref - v) > TOL):
                fail(f"bench XEB circuit: QC-1 {v} vs {ref}")
    # Mirror
    for mc in c["mirror"]:
        close(rho_of(mc["qasm"], mc["width"], m)[0, 0].real, mc["success"], "mirror success")
    # T1/T2 closed forms
    t = c["t1t2"]
    gad, gpd = M["ad"]["ad"], M["pd"]["pd"]
    close([(1 - gad) ** (k + 1) for k in t["delays"]], t["ad"]["t1"], "T1 curve (pure AD)")
    close(-1 / np.log(1 - gad), t["ad"]["T1"], "T1 fit", 1e-6)
    close([(1 + np.sqrt(1 - gpd) ** (k + 1)) / 2 for k in t["delays"]], t["pd"]["ramsey"], "Ramsey curve (pure dephasing)")
    close(-2 / np.log(1 - gpd), t["pd"]["T2"], "T2 fit", 1e-6)
    close(-2 / np.log(1 - gpd), t["pd"]["T2echo"], "T2 echo fit", 1e-6)
    # Process tomography: R_ij = Tr(P_i Λ(P_j)) / d, labels big-endian (reversed for Qiskit's little-endian matrices).
    for tm in c["tomography"]:
        n = tm["n"]
        qc = qasm3.loads(tm["qasm"])
        d = 1 << n
        labels = ["".join("IXYZ"[(k >> (2 * (n - 1 - q))) & 3] for q in range(n)) for k in range(4 ** n)]
        P = [SparsePauliOp(l[::-1]).to_matrix() for l in labels]
        U = Operator(qc).data
        ideal = [[np.real(np.trace(P[i] @ U @ P[j] @ U.conj().T)) / d for j in range(4 ** n)] for i in range(4 ** n)]
        noisy = [[np.real(np.trace(P[i] @ channel(qc, n, m, P[j]))) / d for j in range(4 ** n)] for i in range(4 ** n)]
        close(ideal, tm["ideal"], f"tomography {n}q ideal", 1e-9)
        close(noisy, tm["noisy"], f"tomography {n}q noisy", 1e-9)
    # Repetition code
    for q in c["qec"]:
        d = q["d"]
        for p_, v in q["rates"]:
            close(sum(comb(d, k) * p_ ** k * (1 - p_) ** (d - k) for k in range(d // 2 + 1, d + 1)), v, f"repetition d={d} p={p_}", 1e-12)
    print("  bench: RB, interleaved RB, unitarity, QV, XEB, mirror, T1/T2, tomography, repetition code agree")
    write_fixture("bench", "Aer errors as Kraus maps on DensityMatrix; scipy curve_fit; closed forms", [
        {"id": "rb", "survival": surv, "p": p, "A": A, "B": B, "interleaved": surv_i},
        {"id": "unitarity", "purity": pur, "u": uu},
        {"id": "t1t2", "T1": -1 / np.log(1 - gad), "T2": -2 / np.log(1 - gpd)},
        {"id": "rbx", "survival": surv_x, "p": 0.8},
    ], {"abs": 1e-6, "p": 1e-6, "A": 1e-6, "B": 1e-6, "u": 1e-6})  # fits converge to ~1e-9 across platforms


if __name__ == "__main__":
    main()
