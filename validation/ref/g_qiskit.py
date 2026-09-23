"""Phase 11 references: the Qiskit Python export.

Each generated script is executed as-is; the resulting QuantumCircuit (with
symbols bound where needed) must reproduce the committed Qiskit reference of
the same program exactly: Statevector.reverse_qargs() for the gate, random
and symbolic groups (global phase included), and g_classical's interpreter
with the recorded outcomes for the classical group (if_test).
"""
import json

import numpy as np
from qiskit.quantum_info import Statevector

from common import FIXTURES, OUT, fail, write_fixture
from g_classical import run as run_classical

MEAS = {"measure", "measure_x", "measure_y", "reset"}


def build(script):
    env = {}
    exec(compile(script, "<qc1 export>", "exec"), env)
    return env["qc"]


def main():
    doc = json.load(open(OUT / "qiskit.cases.json"))
    refs = {g: {c["id"]: c for c in json.load(open(FIXTURES / f"{g}.json"))["cases"]} for g in ("gates", "random-tapes", "symbolic", "classical")}
    points = json.load(open(OUT / "symbolic.cases.json"))["points"]
    worst, count = 0.0, 0
    for c in doc["cases"]:
        g, ref = c["group"], refs[c["group"]][c["id"]]
        qc = build(c["python"])
        if g in ("gates", "random-tapes"):
            exp = np.array(ref["expected"]["re"]) + 1j * np.array(ref["expected"]["im"])
            got = Statevector(qc).reverse_qargs().data
            err = float(np.max(np.abs(got - exp)))
        elif g == "symbolic":
            err = 0.0
            for k, p in enumerate(points):
                ps = {x.name: x for x in qc.parameters}
                bound = qc.assign_parameters({ps[name]: p[name] for name in ps})
                exp = np.array(ref["expected"][k]["re"]) + 1j * np.array(ref["expected"][k]["im"])
                err = max(err, float(np.max(np.abs(Statevector(bound).reverse_qargs().data - exp))))
        else:
            outcomes = [s.get("outcome") for e in ref["tape"] for s in e if s["gateId"] in MEAS]
            psi, bits = run_classical(qc, c["n"], outcomes)
            # The classical fixture stores bits; the state is QC-1's (validated there) — compare bits here.
            if (bits or [0] * c["n"]) != ref["cbits"]:
                fail(f"qiskit export {g}/{c['id']}: classical bits {bits} vs {ref['cbits']}")
            err = 0.0
        worst = max(worst, err)
        count += 1
        if err > 1e-9:
            fail(f"qiskit export {g}/{c['id']}: statevector differs by {err:.2e}")
    print(f"  qiskit: {count} generated scripts run, worst difference {worst:.2e}")
    write_fixture("qiskit", "exec() of the generated Qiskit script → Statevector (exact), if_test interpreter", [{"id": "summary", "scripts": count}], {})


if __name__ == "__main__":
    main()
