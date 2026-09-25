"""Phase 8 references: the noise model.

The channels are built with qiskit_aer.noise's own constructors
(depolarizing_error, amplitude_damping_error, phase_damping_error,
ReadoutError), so QC-1's conventions are Aer's by construction:

  * unitary tapes: every instruction of QC-1's QASM export (Qiskit's import)
    is applied to a qiskit.quantum_info.DensityMatrix, followed by its
    errors as Kraus maps (depolarizing by instruction size, then amplitude
    and phase damping on each qubit, then crosstalk on coupling neighbours of
    two-qubit gates). QC-1's density matrix must match exactly; its
    trajectory-averaged probabilities within 5σ (+1e-3); its Bloch vectors
    exactly (they come from ρ).
  * measured / conditional tapes: qiskit-aer runs the export with a NoiseModel
    (all-qubit errors per gate size, readout errors; nothing per-qubit here
    except where the model has none); QC-1's trajectory distribution of the
    classical bits must agree within 5σ per outcome.
"""
import json

import numpy as np
from qiskit import qasm3, transpile
from qiskit.quantum_info import DensityMatrix, Kraus, partial_trace
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, ReadoutError, amplitude_damping_error, depolarizing_error, phase_damping_error

from common import OUT, fail, write_fixture


def rate(m, key, q):
    per = (m.get("perQubit") or [])
    if q < len(per) and per[q].get(key) is not None:
        return per[q][key]
    return m[key]


def name_of(inst):
    return inst.operation.name


def errors_after(m, inst, qs):
    """[(qubits, QuantumError)] after one instruction, in QC-1's documented order."""
    out = []
    named = (m.get("perGate") or {}).get(name_of(inst))
    if len(qs) == 1:
        p = named if named is not None else rate(m, "p1", qs[0])
        if p > 0:
            out.append((qs, depolarizing_error(p, 1)))
    elif len(qs) == 2:
        p = named if named is not None else m["p2"]
        if p > 0:
            out.append((qs, depolarizing_error(p, 2)))
    else:
        p = named if named is not None else m["p2"]
        if p > 0:
            out += [([q], depolarizing_error(p, 1)) for q in qs]
    for q in qs:
        ad, pd = rate(m, "ad", q), rate(m, "pd", q)
        if ad > 0:
            out.append(([q], amplitude_damping_error(ad)))
        if pd > 0:
            out.append(([q], phase_damping_error(pd)))
    if len(qs) == 2 and m.get("crosstalk", 0) > 0 and m.get("coupling"):
        a, b = qs
        spect = sorted({x for x in (m["coupling"][a] + m["coupling"][b]) if x not in (a, b)})
        out += [([x], depolarizing_error(m["crosstalk"], 1)) for x in spect]
    return out


def density(qc, n, m):
    rho = DensityMatrix.from_label("0" * n)
    for inst in qc.data:
        qs = [qc.find_bit(q).index for q in inst.qubits]
        # QC-1 qubit q is Qiskit qubit q (q[k] ↔ index k), and QC-1 uses Qiskit's bit order.
        rho = rho.evolve(inst.operation, qs)
        for eq, err in errors_after(m, inst, qs):
            rho = rho.evolve(Kraus(err), eq)
    return rho.data


def main():
    doc = json.load(open(OUT / "noise.cases.json"))
    out_u, out_c = [], []
    worst = 0.0
    for c in doc["unitary"]:
        n, qc1 = c["n"], c["qc1"]
        m = qc1["model"]
        qc = qasm3.loads(c["qasm"])
        ref = density(qc, n, m)
        d = 1 << n
        mine = (np.array(qc1["rho"][0::2]) + 1j * np.array(qc1["rho"][1::2])).reshape(d, d)
        err = float(np.max(np.abs(ref - mine)))
        worst = max(worst, err)
        if err > 1e-10:
            fail(f"noise {c['id']} ({c['model']}): density matrix differs by {err:.2e}")
        p = np.real(np.diag(ref))
        T = qc1["trajectories"]
        for i, (a, b) in enumerate(zip(p, qc1["trajProbs"])):
            if abs(a - b) > 5 * np.sqrt(max(a * (1 - a), 1e-12) / T) + 1e-3:
                fail(f"noise {c['id']}: trajectory probability of {i}: {b:.4f} vs ρ {a:.4f}")
        # Bloch vectors from ρ.
        for q in range(n):
            red = partial_trace(DensityMatrix(ref), [k for k in range(n) if k != q]).data
            x, y, z = 2 * red[1, 0].real, 2 * red[1, 0].imag, (red[0, 0] - red[1, 1]).real
            b = qc1["bloch"][q]
            if max(abs(x - b["x"]), abs(y - b["y"]), abs(z - b["z"])) > 1e-10:
                fail(f"noise {c['id']}: Bloch q{q} {b} vs ({x}, {y}, {z})")
        out_u.append({"id": c["id"], "n": n, "tape": c["tape"], "model": c["model"],
                      "rho": {"re": [float(v) for v in ref.real.ravel()], "im": [float(v) for v in ref.imag.ravel()]}})
    for c in doc["classical"]:
        n, qc1 = c["n"], c["qc1"]
        m = qc1["model"]
        if m.get("perQubit") or m.get("perGate") or m.get("crosstalk"):
            # Aer's NoiseModel check below uses all-qubit errors: exercise the global model only.
            pass
        qc = qasm3.loads(c["qasm"])
        nm = NoiseModel()
        names1 = sorted({i.operation.name for i in qc.data if i.operation.num_qubits == 1 and i.operation.name not in ("measure", "reset")}
                        | {b.operation.name for i in qc.data if i.operation.name == "if_else" for b in i.operation.params[0].data})
        names2 = sorted({i.operation.name for i in qc.data if i.operation.num_qubits == 2 and i.operation.name != "if_else"})
        e1 = depolarizing_error(m["p1"], 1).compose(amplitude_damping_error(m["ad"])).compose(phase_damping_error(m["pd"]))
        adpd = amplitude_damping_error(m["ad"]).compose(phase_damping_error(m["pd"]))
        e2 = depolarizing_error(m["p2"], 2).compose(adpd.tensor(adpd))
        if names1:
            nm.add_all_qubit_quantum_error(e1, names1)
        if names2:
            nm.add_all_qubit_quantum_error(e2, names2)
        ro, ro10 = m["readout"], m.get("readout10", m["readout"])  # P(1|0), P(0|1)
        nm.add_all_qubit_readout_error(ReadoutError([[1 - ro, ro], [ro10, 1 - ro10]]))
        sim = AerSimulator(noise_model=nm, seed_simulator=4242)
        shots = 40000
        counts = sim.run(transpile(qc, sim, optimization_level=0), shots=shots).result().get_counts()
        T = qc1["trajectories"]
        keys = set(counts) | set(qc1["counts"])  # both print c[n-1] … c[0]
        for key in keys:
            fa = counts.get(key, 0) / shots
            fq = qc1["counts"].get(key, 0) / T
            p = (fa + fq) / 2
            sigma = np.sqrt(max(p * (1 - p), 1e-6) * (1 / shots + 1 / T))
            if abs(fa - fq) > 5 * sigma + 2e-3:
                fail(f"noise {c['id']}: c={key}: QC-1 trajectories {fq:.4f} vs Aer {fa:.4f}")
        out_c.append({"id": c["id"], "n": n, "tape": c["tape"], "model": c["model"],
                      "aer": {k: v / shots for k, v in sorted(counts.items())}, "shots": shots})
    print(f"  noise: density matrices within {worst:.1e}; {len(out_c)} classical programs agree with Aer")
    write_fixture("noise", "qiskit_aer.noise errors as Kraus maps on DensityMatrix (exact); AerSimulator with NoiseModel (5σ)",
                  [{"kind": "unitary", **x} for x in out_u] + [{"kind": "classical", **x} for x in out_c],
                  # Aer shot frequencies are statistical (platform/thread scheduling): drift allows 0.02.
                  {"abs": 1e-10, "aer": 0.02})


if __name__ == "__main__":
    main()
