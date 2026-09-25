"""Phase 6 references: synthesis tools.

  * State preparation: Qiskit's statevector of the synthesized circuit (QC-1's
    QASM export) equals the normalised target up to a global phase.
  * Unitary synthesis (Gray-code two-level u_arb gates, exported as exact
    ZYZ gate definitions): Qiskit's Operator equals the target up to a global
    phase, and QC-1's own unitary of the tape agrees.
  * Trotter circuits (orders 1, 2, 4): Qiskit's PauliEvolutionGate with
    LieTrotter / SuzukiTrotter(order) over reps = steps, time = steps·t, is
    the same operator (up to a global phase) as the imported circuit with t
    bound, and as QC-1's unitary.
"""
import numpy as np
from qiskit import QuantumCircuit, qasm3
from qiskit.circuit.library import PauliEvolutionGate
from qiskit.quantum_info import Operator, SparsePauliOp, Statevector
from qiskit.synthesis import LieTrotter, SuzukiTrotter

from common import fail, load_cases, write_fixture, r

TOL = 1e-9


def phase_err(expected, got):
    k = np.unravel_index(np.argmax(np.abs(expected)), expected.shape)
    ph = got[k] / expected[k]
    return float(max(abs(abs(ph) - 1), np.max(np.abs(ph * expected - got))))


def cmat(u, d):
    return (np.array(u["re"]) + 1j * np.array(u["im"])).reshape(d, d)


def parse_sum(text):
    """'0.5*XY - 0.8*YZ + ZX' → [(label, coeff)] (independent of QC-1's parser)."""
    import re
    out = []
    for sign, coef, label in re.findall(r"([+-]?)\s*(?:([0-9.eE+-]+)\*)?([IXYZ]+)", text.replace(" ", "")):
        c = float(coef) if coef else 1.0
        out.append((label, -c if sign == "-" else c))
    return out


def main():
    doc = __import__("json").load(open(__import__("common").OUT / "synth.cases.json"))
    prep_out, synth_out, trot_out = [], [], []
    worst = 0.0
    for c in doc["prep"]:
        target = np.array(c["re"]) + 1j * np.array(c["im"])
        target /= np.linalg.norm(target)
        psi = Statevector(qasm3.loads(c["qc1"]["qasm"])).data
        ov = abs(np.vdot(target, psi))
        worst = max(worst, 1 - ov)
        if abs(ov - 1) > TOL:
            fail(f"synth prep {c['id']}: |<target|psi>| = {ov}")
        if abs(c["qc1"]["overlap"] - ov) > TOL:
            fail(f"synth prep {c['id']}: QC-1 overlap {c['qc1']['overlap']} vs Qiskit {ov}")
        prep_out.append({"id": c["id"], "n": c["n"], "re": c["re"], "im": c["im"], "overlap": r(ov, 10), "gates": c["qc1"]["gates"]})
    for c in doc["synth"]:
        d = 1 << c["n"]
        U = np.array([[z["re"] + 1j * z["im"] for z in row] for row in c["U"]])
        got = Operator(qasm3.loads(c["qc1"]["qasm"])).data
        e1, e2 = phase_err(U, got), phase_err(U, cmat(c["qc1"]["unitary"], d))
        worst = max(worst, e1, e2)
        if e1 > TOL or e2 > TOL:
            fail(f"synth unitary {c['id']}: Qiskit err {e1:.2e}, QC-1 err {e2:.2e}")
        synth_out.append({"id": c["id"], "n": c["n"], "U": c["U"], "gates": c["qc1"]["gates"]})
    for c in doc["trotter"]:
        n, d = c["n"], 1 << c["n"]
        terms = parse_sum(c["text"])
        op = SparsePauliOp([l for l, _ in terms], [k for _, k in terms])
        synth = LieTrotter(reps=c["steps"]) if c["order"] == 1 else SuzukiTrotter(order=c["order"], reps=c["steps"])
        qc = QuantumCircuit(n)
        qc.append(PauliEvolutionGate(op, time=c["steps"] * c["t"], synthesis=synth), range(n))
        # The case's labels are Qiskit's (q0 rightmost), as QC-1's LAB inputs are.
        ref = Operator(qc.decompose(reps=3)).data
        imp = qasm3.loads(c["qc1"]["qasm"])
        imp = imp.assign_parameters({p: c["t"] for p in imp.parameters})
        got = Operator(imp).data
        e1, e2 = phase_err(ref, got), phase_err(ref, cmat(c["qc1"]["unitary"], d))
        worst = max(worst, e1, e2)
        if e1 > TOL or e2 > TOL:
            fail(f"synth trotter {c['id']}: Qiskit err {e1:.2e}, QC-1 err {e2:.2e}")
        trot_out.append({k: c[k] for k in ("id", "n", "text", "steps", "order", "t")})
    print(f"  synth: worst error {worst:.2e}")
    write_fixture("synth", "qiskit Statevector / Operator; PauliEvolutionGate with LieTrotter / SuzukiTrotter",
                  [{"kind": "prep", **x} for x in prep_out] + [{"kind": "unitary", **x} for x in synth_out] + [{"kind": "trotter", **x} for x in trot_out],
                  {"abs": TOL})


if __name__ == "__main__":
    main()
