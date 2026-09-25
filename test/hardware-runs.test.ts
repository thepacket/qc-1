import { expect, test } from "vitest";
import { calc, add } from "./ed";
import { Register } from "../src/calc/register";
import { runAnalysis } from "../src/analysis/run";
import { sanitiseNoise } from "../src/noise/model";
import { estimateView } from "../src/calc/estimate";
import { observableMoments } from "../src/sim/observableVariance";
import { REDUCED, type MeasuredState } from "../src/sim/density";

test.each([1, 21])("independent measured circuit shots, including stabilizer mode (n=%i)", n => {
  const c = calc(); c.setQubitCount(n);
  add(c, "h", [0]); add(c, "measure", [0]);
  const recorded = c.tape[1][0].outcome;
  c.setShots(1000); c.autoShots = true; c.setMode("prob");
  const p = c.view!;
  if (p.mode !== "prob") throw new Error(p.mode);
  const p1 = p.stab ? p.marginals![0] : p.rows.find(r => r.i === 1)!.p;
  expect(p1).toBeGreaterThan(0.4); expect(p1).toBeLessThan(0.6);
  c.setMode("bloch");
  if (c.view!.mode === "bloch") expect(Math.abs(c.view!.vectors[0].z)).toBeLessThan(0.2);
  expect(c.tape[1][0].outcome).toBe(recorded); // sampling must not alter the editor
});

test("fresh classical outcomes drive feed-forward, and scrubbed sampling uses only the prefix", () => {
  const c = calc(); c.setQubitCount(1);
  add(c, "h", [0]); add(c, "measure", [0]);
  const tape = [...c.tape, [{ ...c.tape[0][0], id: "feedback", gateId: "x", condition: { clbit: 0, value: 1 as const } }]];
  const d = calc({ ...c.save(), tape });
  d.autoShots = true; d.setMode("prob");
  if (d.view!.mode === "prob") expect(d.view!.rows[0].p).toBe(1);
  d.scrub = 1; d.setMode("bloch");
  if (d.view!.mode === "bloch") expect(d.view!.vectors[0].x).toBe(1);
});

test("ideal dynamic-circuit tomography reconstructs the ensemble, not a recorded branch", async () => {
  const c = calc(); c.setQubitCount(1); add(c, "h", [0]); add(c, "measure", [0]);
  const ctx = { n: 1, tape: c.tape, scope: {}, state: new Register(1, c.tape).state };
  const r = await runAnalysis("density", ctx, { kept: [0] }, { shots: 3000, seed: 5 });
  expect(r.error).toBeUndefined();
  expect(r.scalars!.find(s => s.label === "purity Tr ρ²")!.value).toBeCloseTo(0.5, 2);
});

test("measured expectation keeps depolarizing noise and the mixed-state variance", async () => {
  const c = calc(); c.setQubitCount(1); add(c, "x", [0]);
  const noise = sanitiseNoise({ enabled: true, p1: 0.5, p2: 0, ad: 0, pd: 0, readout: 0 });
  const ctx = { n: 1, tape: c.tape, scope: {}, state: new Register(1, c.tape).state, noise };
  const r = await runAnalysis("expectation", ctx, { obs: "Z" }, { shots: 20000, seed: 5 });
  expect(r.error).toBeUndefined();
  expect(r.scalars!.find(s => s.label === "⟨H⟩")!.value).toBeCloseTo(-0.5, 1);
  expect(r.scalars!.find(s => s.label === "Var(H)")!.value).toBeCloseTo(0.75, 1);
  const unsupported = await runAnalysis("magic", ctx, {}, { shots: 100, seed: 5 });
  expect(unsupported.error).toMatch(/mixed density matrix/);
});

test("mixed-state Hamiltonian moments include cross terms and imaginary coherences", () => {
  const st = new Float64Array(4) as MeasuredState;
  // Bloch vector (0, 0.6, 0.2); H = Y + Z has H² = 2I.
  st[REDUCED] = () => [[{ re: 0.6, im: 0 }, { re: 0, im: -0.3 }], [{ re: 0, im: 0.3 }, { re: 0.4, im: 0 }]];
  const m = observableMoments(st, 1, [{ coefficient: 1, paulis: "Y" }, { coefficient: 1, paulis: "Z" }]);
  expect(m.mean).toBeCloseTo(0.8, 10); expect(m.second).toBeCloseTo(2, 10);
  expect(m.variance).toBeCloseTo(1.36, 10);
});

test.each([[0.4, 0.4], [0.1, 0.3]])("readout mitigation propagates multinomial uncertainty (%f, %f)", (p01, p10) => {
  const shots = 10000, det = 1 - p01 - p10;
  const run = { z: new Map([[0, shots / 2], [1, shots / 2]]), bloch: () => [{ x: 0, y: 0, z: 0 }], device: { readout: [[p01, p10] as [number, number]] }, mitigate: true, seed: 1, tomography: () => null };
  const b = estimateView("bloch", 1, shots, run);
  if (b.mode !== "bloch") throw new Error(b.mode);
  expect(b.errors![0].z).toBeCloseTo(1 / Math.sqrt(shots) / det, 10);
  const p = estimateView("prob", 1, shots, run);
  if (p.mode !== "prob") throw new Error(p.mode);
  expect(p.rows[0].se).toBeCloseTo(0.5 / Math.sqrt(shots) / det, 10);
  expect(p.rows[1].se).toBeCloseTo(p.rows[0].se!, 10);
});
