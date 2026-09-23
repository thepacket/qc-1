"""Phase 8 references: quantities derived from the noisy density matrix.

ρ is rebuilt with qiskit_aer.noise errors (g_noise.density); then
  fidelity = qiskit state_fidelity(ψ, ρ); purity, entropy (base 2) and
  partial traces from qiskit.quantum_info; trace distance and eigenvalues from
  numpy; coherent information S(B) − S(AB); l1 and relative-entropy
  coherence; the Pauli-twirled budget from qiskit's PTM of each Aer error;
  readout confusion A = ⊗[[1−p, p], [p, 1−p]] and its inverse; decoherence
  by prefix; ZNE with the rates scaled (numpy polyfit / Lagrange / the
  3-point exponential); and the PEC-corrected ρ equals the ideal ρ.
"""
import json

import numpy as np
from qiskit import qasm3
from qiskit.quantum_info import DensityMatrix, PTM, Statevector, entropy, partial_trace, purity, state_fidelity
from qiskit_aer.noise import amplitude_damping_error, phase_damping_error

from common import OUT, fail, write_fixture
from g_noise import density

TOL = 1e-9


def scaled(m, f):
    c = lambda x: None if x is None else min(1.0, x * f)
    out = dict(m)
    for k in ("p1", "p2", "ad", "pd", "crosstalk"):
        out[k] = c(m[k])
    if m.get("perQubit"):
        out["perQubit"] = [{**r, "p1": c(r.get("p1")), "ad": c(r.get("ad")), "pd": c(r.get("pd"))} for r in m["perQubit"]]
    if m.get("perGate"):
        out["perGate"] = {k: c(v) for k, v in m["perGate"].items()}
    return out


def pauli_matrix(label):
    from qiskit.quantum_info import SparsePauliOp
    return SparsePauliOp(label).to_matrix()


def parse_sum(text):
    import re
    out = []
    for sign, coef, label in re.findall(r"([+-]?)\s*(?:([0-9.eE]+)\*)?([IXYZ]+)", text.replace(" ", "")):
        c = float(coef) if coef else 1.0
        out.append((label, -c if sign == "-" else c))
    return out


def expectation(rho, terms):
    return float(np.real(sum(k * np.trace(rho @ pauli_matrix(l)) for l, k in terms)))


def rate(m, key, q):
    per = m.get("perQubit") or []
    return per[q][key] if q < len(per) and per[q].get(key) is not None else m[key]


def twirl(err):
    R = PTM(err).data  # Pauli order I, X, Y, Z
    rxx, ryy, rzz = R[1, 1].real, R[2, 2].real, R[3, 3].real
    return ((1 + rxx - ryy - rzz) / 4, (1 - rxx + ryy - rzz) / 4, (1 - rxx - ryy + rzz) / 4)


def close(a, b, what, tol=TOL):
    a, b = np.real(np.asarray(a, complex)), np.real(np.asarray(b, complex))
    if a.shape != b.shape or np.max(np.abs(a - b)) > tol:
        fail(f"noise-analyses {what}: QC-1 {b} vs reference {a}")


def main():
    doc = json.load(open(OUT / "noise-analyses.cases.json"))
    out = []
    for c in doc["cases"]:
        n, qc1, m = c["n"], c["qc1"], c["qc1"]["model"]
        cid = c["id"]
        qc = qasm3.loads(c["qasm"])
        rho = density(qc, n, m)  # big-endian
        d = 1 << n
        psi = np.array(qc1["idealState"][0::2]) + 1j * np.array(qc1["idealState"][1::2])
        ref_sv = Statevector(qc).reverse_qargs().data
        if np.max(np.abs(ref_sv - psi)) > 1e-10:
            fail(f"noise-analyses {cid}: ideal state")
        R = DensityMatrix(rho)  # (as a little-endian object: only basis-free quantities are read from it)
        F = state_fidelity(Statevector(psi), R)
        ev = np.sort(np.clip(np.linalg.eigvalsh(rho), 0, None))[::-1]
        td = 0.5 * np.sum(np.abs(np.linalg.eigvalsh(rho - np.outer(psi, psi.conj()))))
        imp = qc1["impact"]
        close([F, td, purity(R).real, entropy(R, base=2)],
              [imp["fidelity ⟨ψ|ρ|ψ⟩"], imp["trace distance"], imp["purity Tr ρ²"], imp["entropy S(ρ)"]], f"{cid} impact")
        close(ev[:16], qc1["spectrum"], f"{cid} spectrum")
        # Coherent information across A | B (big-endian qubits → Qiskit indices n−1−q).
        A = c["cut"]
        B = [q for q in range(n) if q not in A]
        qi = lambda qs: [n - 1 - q for q in qs]
        SB = entropy(partial_trace(R, qi(A)), base=2)
        SA = entropy(partial_trace(R, qi(B)), base=2)
        SAB = entropy(R, base=2)
        ci = qc1["coherentInfo"]
        close([SB - SAB, SA - SAB], [ci["I(A⟩B) = S(B) − S(AB)"], ci["I(B⟩A) = S(A) − S(AB)"]], f"{cid} coherent information")
        diag = np.clip(np.real(np.diag(rho)), 0, None)
        l1 = np.sum(np.abs(rho)) - np.sum(np.abs(np.diag(rho)))
        Sdiag = -np.sum([p * np.log2(p) for p in diag if p > 1e-15])
        coh = qc1["coherence"]
        close([l1, Sdiag - SAB], [coh["l1 coherence (noisy)"], coh["relative-entropy coherence (noisy)"]], f"{cid} coherence")
        # Pauli budget per qubit from the PTMs of Aer's errors.
        for q, row in enumerate(qc1["budget"]):
            p1 = rate(m, "p1", q)
            dx = dy = dz = p1 / 4
            ax, ay, az = twirl(amplitude_damping_error(rate(m, "ad", q)))
            px, py, pz = twirl(phase_damping_error(rate(m, "pd", q)))
            close([dx + ax + px, dy + ay + py, dz + az + pz, rate(m, "readout", q)], [row[1], row[2], row[3], row[5]], f"{cid} Pauli budget q{q}")
        # Readout: A = ⊗ A_q applied to diag ρ, then inverted.
        A_full = np.array([[1.0]])
        for q in range(n):
            p = rate(m, "readout", q)
            A_full = np.kron(A_full, np.array([[1 - p, p], [p, 1 - p]]))
        measured = A_full @ diag
        mitig = np.clip(np.linalg.solve(A_full, measured), 0, None)
        mitig /= mitig.sum()
        for row in qc1["readout"]:
            i = int(row[0][1:-1], 2)
            close([diag[i], measured[i], mitig[i]], row[1:], f"{cid} readout {row[0]}")
        # Decoherence by prefix.
        fids, purs = [], []
        tape = c["tape"]
        for k in range(1, len(tape) + 1):
            sub = qasm3.loads(prefix_qasm(c["qasm"], k))
            r = density(sub, n, m)
            ps = Statevector(sub).reverse_qargs().data
            fids.append(float(np.real(ps.conj() @ r @ ps)))
            purs.append(float(np.real(np.trace(r @ r))))
        close(fids, qc1["decoherence"]["fidelity"], f"{cid} decoherence fidelity")
        close(purs, qc1["decoherence"]["purity"], f"{cid} decoherence purity")
        # ZNE at scales 1, 2, 3.
        terms = parse_sum(c["obs"])
        ys = [expectation(density(qc, n, scaled(m, s)), terms) for s in (1, 2, 3)]
        xs = np.array([1.0, 2.0, 3.0])
        lin = np.polyfit(xs, ys, 1)[1]
        rich = np.polyval(np.polyfit(xs, ys, 2), 0.0)
        d1, d2 = ys[1] - ys[0], ys[2] - ys[1]
        if abs(d1) < 1e-15 or d2 / d1 <= 0:
            expo = rich
        else:
            rr = d2 / d1
            b = d1 / (rr * (rr - 1))
            expo = ys[0] - b * rr + b
        z = qc1["zne"]
        close(ys, z["linear"]["samples"], f"{cid} ZNE samples")
        close([lin, rich, expo], [z["linear"]["value"], z["richardson"]["value"], z["exponential"]["value"]], f"{cid} ZNE", 1e-8)
        # PEC: noise, then the quasi-probabilistic inverses, gives back the ideal ρ.
        pr = (np.array(qc1["pecRho"][0::2]) + 1j * np.array(qc1["pecRho"][1::2])).reshape(d, d)
        close(np.abs(pr - np.outer(psi, psi.conj())).max(), 0.0, f"{cid} PEC-corrected ρ vs ideal", 1e-10)
        out.append({"id": cid, "n": n, "tape": c["tape"], "model": c["model"], "obs": c["obs"], "cut": c["cut"],
                    "impact": [F, td, float(purity(R).real), float(SAB)], "zne": [lin, rich, expo]})
    # Device calibration: QC-1's damping must be Aer's thermal_relaxation_error, and its
    # 1-qubit gate channel must have the calibrated average gate infidelity.
    from qiskit.quantum_info import average_gate_fidelity
    from qiskit_aer.noise import depolarizing_error, thermal_relaxation_error
    cal = doc["calibration"]
    snap = json.loads(cal["json"])
    for q, per in enumerate(cal["model"]["perQubit"]):
        props = {p["name"]: p["value"] for p in snap["qubits"][q]}
        T1, T2 = props["T1"], min(props["T2"], 2 * props["T1"])
        thermal = PTM(thermal_relaxation_error(T1, T2, cal["t"])).data
        mine = PTM(amplitude_damping_error(per["ad"]).compose(phase_damping_error(per["pd"]))).data
        close(thermal, mine, f"calibration q{q}: damping vs thermal_relaxation_error", 1e-12)
        full = depolarizing_error(per["p1"], 1).compose(amplitude_damping_error(per["ad"])).compose(phase_damping_error(per["pd"]))
        r = 1 - average_gate_fidelity(PTM(full))
        # Relaxation alone may exceed the reported error: then no depolarizing is added (as in Aer's device model).
        r_relax = 1 - average_gate_fidelity(PTM(amplitude_damping_error(per["ad"]).compose(phase_damping_error(per["pd"]))))
        close(r, max(cal["sxErr"][q], r_relax), f"calibration q{q}: average gate infidelity", 1e-6)
        close(per["readout"], props["readout_error"], f"calibration q{q}: readout")
    pg = cal["model"]["perGate"]
    close(pg["ecr"], 4 / 3 * 9e-3, "calibration: ecr depolarizing λ = 4r/3 of the median")
    close(1 - average_gate_fidelity(PTM(depolarizing_error(pg["ecr"], 2))), 9e-3, "calibration: ecr infidelity", 1e-12)
    print(f"  noise-analyses: {len(out)} cases")
    write_fixture("noise-analyses", "qiskit.quantum_info (state_fidelity, entropy, partial_trace, PTM) on ρ from qiskit_aer.noise errors; numpy", out, {"abs": TOL})


def prefix_qasm(text, k):
    """The program with only its first k gate statements (one per QC-1 entry here)."""
    lines = text.split("\n")
    body_start = next(i for i, l in enumerate(lines) if l.startswith("qubit[")) + 1
    body = [l for l in lines[body_start:] if l.strip() and not l.startswith("//")]
    return "\n".join(lines[:body_start] + body[:k]) + "\n"


if __name__ == "__main__":
    main()
