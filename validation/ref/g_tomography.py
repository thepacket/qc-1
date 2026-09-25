"""SHOTS → repeat's state tomography (src/calc/tomography.ts).

For each case, from QC-1's own per-setting counts:
  * every setting's exact outcome probabilities equal Qiskit's DensityMatrix
    rotated into that basis (H for X, S† then H for Y) and measured;
  * the linear inversion ρ̂ = Σ_P ⟨P⟩ P / 2ⁿ, with ⟨P⟩ averaged over the settings
    that measure P and P built from Qiskit's Pauli labels;
  * the Smolin–Gambetta–Smith projection onto a physical ρ;
  * the leading eigenvector, global phase set so its largest amplitude is
    real and positive;
all computed here independently, must equal QC-1's to 1e-10.
"""
import itertools
import json

import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import DensityMatrix, Pauli

from common import OUT, fail, r, write_fixture

TOL = 1e-10


def cvec(flat):
    return np.array(flat[0::2]) + 1j * np.array(flat[1::2])


def cmat(flat, d):
    return cvec(flat).reshape(d, d)


def setting_probs(rho, n, setting):
    qc = QuantumCircuit(n)
    for q, b in enumerate(setting):
        if b == 1:
            qc.sdg(q)
        if b in (0, 1):
            qc.h(q)
    return DensityMatrix(rho).evolve(qc).probabilities()


def linear_inversion(n, settings, counts, shots):
    d = 2 ** n
    rho = np.zeros((d, d), dtype=complex)
    letters = "XYZ"
    sums, nums = {}, {}
    for s, cnt in zip(settings, counts):
        f = np.zeros(d)
        for x, c in cnt:
            f[x] += c / shots
        for mask in range(d):
            e = sum(f[x] * (-1) ** bin(x & mask).count("1") for x in range(d))
            label = "".join(letters[s[q]] if (mask >> q) & 1 else "I" for q in reversed(range(n)))  # Qiskit label: q0 rightmost
            sums[label] = sums.get(label, 0) + e
            nums[label] = nums.get(label, 0) + 1
    for label in sums:
        rho += sums[label] / nums[label] * Pauli(label).to_matrix() / d
    return rho


def sgs(rho_hat):
    """Smolin, Gambetta & Smith 2012: nearest physical ρ in the 2-norm with the same eigenvectors."""
    mu, V = np.linalg.eigh(rho_hat)
    order = np.argsort(mu)[::-1]
    mu, V = mu[order], V[:, order]
    d = len(mu)
    lam = np.zeros(d)
    a, i = 0.0, d
    while i > 0 and mu[i - 1] + a / i < 0:
        a += mu[i - 1]
        i -= 1
    lam[:i] = mu[:i] + a / i
    return (V * lam) @ V.conj().T, lam, V


def leading(V):
    v = V[:, 0]
    k = int(np.argmax(np.abs(v)))
    return v * np.exp(-1j * np.angle(v[k]))


def main():
    doc = json.load(open(OUT / "tomography.cases.json"))
    out, worst = [], 0.0
    for c in doc["cases"]:
        n, d, q = c["n"], 2 ** c["n"], c["qc1"]
        rho = cmat(c["rho"], d)
        settings = [tuple(s) for s in q["settings"]]
        if sorted(settings) != sorted(itertools.product(range(3), repeat=n)):
            fail(f"tomography {c['id']}: the settings aren't all 3^n")
        errs = []
        for s, p in zip(settings, q["probs"]):
            errs.append(np.max(np.abs(setting_probs(rho, n, s) - np.array(p))))
        rho_hat = linear_inversion(n, settings, q["counts"], c["shots"])
        errs.append(np.max(np.abs(rho_hat - cmat(q["rhoHat"], d))))
        phys, lam, V = sgs(rho_hat)
        errs.append(np.max(np.abs(phys - cmat(q["rho"], d))))
        errs.append(np.max(np.abs(lam - np.array(q["values"]))))
        if lam[0] - lam[1] > 1e-6:  # the leading eigenvector is defined
            errs.append(np.max(np.abs(leading(V) - cvec(q["state"]))))
        err = float(max(errs))
        worst = max(worst, err)
        if err > TOL:
            fail(f"tomography {c['id']}: QC-1 differs from the reference by {err:.2e}")
        out.append({"id": c["id"], "rhoHat": [r(x) for z in rho_hat.flatten() for x in (z.real, z.imag)], "values": [r(x) for x in lam]})
    print(f"  tomography: {len(out)} cases, worst difference {worst:.2e}")
    write_fixture("tomography", "Qiskit DensityMatrix setting probabilities; numpy linear inversion (Qiskit Pauli matrices), Smolin-Gambetta-Smith, leading eigenvector", out, {"abs": TOL})


if __name__ == "__main__":
    main()
