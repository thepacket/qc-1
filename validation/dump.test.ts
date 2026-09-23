/**
 * Writes validation case bundles for the Python reference generators.
 * Runs only under vitest.validation.config.ts (`npm run validate:dump`).
 */
import { test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { Register } from "../src/calc/register";
import { exportQasm3 } from "../src/qasm/fromTape";
import { customCases, gateCases, randomCases, type Case } from "./cases/groups/statevector";
import { setCustomGates } from "../src/calc/custom";
import * as ent from "./cases/groups/entanglement";
import * as st2 from "./cases/groups/state2";
import * as sym from "./cases/groups/symbolic";
import * as met from "./cases/groups/metrology";
import * as spc from "./cases/groups/spectrum";
import * as dyn from "./cases/groups/dynamics";
import * as tls from "./cases/groups/tools";
import * as syn from "./cases/groups/synth";
import * as cls from "./cases/groups/classical";
import * as exm from "./cases/groups/examples";
import * as nse from "./cases/groups/noise";
import * as nsa from "./cases/groups/noiseAnalyses";

const OUT = new URL("./out/", import.meta.url);

function bundle(group: string, cases: Case[]) {
  const rows = cases.map((c) => {
    setCustomGates(c.gates ?? []);
    const reg = new Register(c.n, c.tape);
    return { ...c, qasm: exportQasm3(c.n, c.tape), state: Array.from(reg.state) };
  });
  writeFileSync(new URL(`${group}.cases.json`, OUT), JSON.stringify({ group, cases: rows }));
}

test("dump validation cases", async () => {
  mkdirSync(OUT, { recursive: true });
  bundle("gates", [...gateCases(), ...customCases()]);
  bundle("random-tapes", randomCases());
  writeFileSync(
    new URL("entanglement.cases.json", OUT),
    JSON.stringify({
      group: "entanglement",
      cases: ent.cases().map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: ent.compute(c) })),
      page: { pairs: ent.pagePairs, qc1: ent.computePage() },
    }),
  );
  writeFileSync(
    new URL("state2.cases.json", OUT),
    JSON.stringify({
      group: "state2",
      husimi: st2.HUSIMI,
      cases: st2.cases().map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: st2.compute(c) })),
    }),
  );
  writeFileSync(
    new URL("symbolic.cases.json", OUT),
    JSON.stringify({
      group: "symbolic",
      points: sym.POINTS,
      cases: sym.cases().map((c) => {
        setCustomGates(c.gates ?? []);
        return { ...c, qasm: exportQasm3(c.n, c.tape), qc1: sym.compute(c) };
      }),
    }),
  );
  writeFileSync(
    new URL("metrology.cases.json", OUT),
    JSON.stringify({
      group: "metrology",
      states: met.stateCasesM().map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), hamTexts: met.hams(c.n), qc1: met.computeState(c) })),
      symbolic: await Promise.all(met.symCases().map(async (c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: await met.computeSym(c) }))),
      pathPoints: met.PATH_POINTS,
      grid: met.LANDSCAPE_GRID,
    }),
  );
  const circs = spc.circCases();
  writeFileSync(
    new URL("spectrum.cases.json", OUT),
    JSON.stringify({
      group: "spectrum",
      circuits: circs.map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: spc.computeCirc(c) })),
      hams: spc.hamCases().map((h) => {
        const st = circs.find((c) => c.n === h.n && c.id.startsWith("rand"))!;
        return { ...h, stateId: st.id, stateQasm: exportQasm3(st.n, st.tape), qc1: spc.computeHam(h, st) };
      }),
      geom: spc.geomCases().map((g) => ({ ...g, qasm: exportQasm3(g.n, g.tape), qc1: spc.computeGeom(g) })),
    }),
  );
  writeFileSync(
    new URL("dynamics.cases.json", OUT),
    JSON.stringify({ group: "dynamics", points: dyn.P, cases: dyn.cases().map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: dyn.compute(c) })) }),
  );
  writeFileSync(
    new URL("tools.cases.json", OUT),
    JSON.stringify({
      group: "tools",
      cases: tls.cases().map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: tls.compute(c) })),
      structure: tls.structureCases().map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: tls.computeStructure(c) })),
    }),
  );
  writeFileSync(
    new URL("noise.cases.json", OUT),
    JSON.stringify({
      group: "noise",
      unitary: nse.unitaryCases().map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: nse.computeUnitary(c) })),
      classical: nse.classicalCases().map((c) => {
        const qc1 = nse.computeClassical(c);
        return { ...c, tape: qc1.tape, qasm: exportQasm3(c.n, qc1.tape), qc1 };
      }),
    }),
  );
  writeFileSync(
    new URL("noise-analyses.cases.json", OUT),
    JSON.stringify({ group: "noise-analyses", cases: nsa.cases().map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: nsa.compute(c) })), calibration: nsa.calibration() }),
  );
  writeFileSync(
    new URL("examples.cases.json", OUT),
    JSON.stringify({ group: "examples", cases: exm.exampleFiles().map((f) => ({ id: f, ...exm.compute(f) })) }),
  );
  writeFileSync(
    new URL("classical.cases.json", OUT),
    JSON.stringify({ group: "classical", cases: cls.cases().map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: cls.compute(c) })) }),
  );
  writeFileSync(
    new URL("synth.cases.json", OUT),
    JSON.stringify({
      group: "synth",
      prep: syn.prepCases().map((c) => ({ ...c, qc1: syn.computePrep(c) })),
      synth: syn.synthCases().map((c) => ({ ...c, qc1: syn.computeSynth(c) })),
      trotter: syn.trotterCases().map((c) => ({ ...c, qc1: syn.computeTrotter(c) })),
    }),
  );
});
