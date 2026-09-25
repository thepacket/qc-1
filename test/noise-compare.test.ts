import { expect, test } from "vitest";
import { runAnalysis } from "../src/analysis/run";
import { sanitiseNoise } from "../src/noise/model";
import { calc, stateOf } from "./ed";
import type { AnalysisResult } from "../src/analysis/types";
const noise = sanitiseNoise({ enabled: true, p1: 0, p2: 0, ad: 0.3, pd: 0, readout: 0 });
function context(n: number, gates: string) {
  const c = calc(); c.loadQasm(`OPENQASM 3.0; include "stdgates.inc"; qubit[${n}] q; bit[${n}] c; ${gates}`, "comparison");
  return { n, tape: c.tape, scope: {}, state: stateOf(c), noise };
}
function table(r: AnalysisResult, index: number) {
  expect(r.error).toBeUndefined();
  const chart = r.charts![index];
  if (chart.kind !== "table") throw new Error("Expected comparison table");
  return chart.rows;
}

test("damping compares asymmetric probabilities, full-state purity, and the selected observable", async () => {
  const r = await runAnalysis("noisecompare", context(2, "x q[0];"), { obs: "IZ" });
  const metrics = table(r, 0), probs = table(r, 1);
  expect(metrics[0][1]).toBe(1); expect(metrics[0][2]).toBeCloseTo(0.58, 12);
  expect(metrics[1][1]).toBe(-1); expect(metrics[1][2]).toBeCloseTo(-0.4, 12);
  expect(metrics[1][3]).toBeCloseTo(0.6, 12);
  expect(probs[1][0]).toBe("|01⟩"); expect(probs[1][1]).toBe(1); expect(probs[1][2]).toBeCloseTo(0.7, 12);
  expect(probs[2][2]).toBe(0);
  expect(r.scalars![0].value).toBeCloseTo(0.3, 12);
});

test("readout-only errors affect the probability comparison, not purity or observable", async () => {
  const ctx = context(1, "x q[0];"); ctx.noise = { ...noise, ad: 0, readout: 0.1, readout10: 0.2 };
  const before = await runAnalysis("noisecompare", ctx, { obs: "Z", readout: 0 });
  const after = await runAnalysis("noisecompare", ctx, { obs: "Z", readout: 1 });
  expect(table(before, 0)).toEqual(table(after, 0));
  expect(table(after, 1)[1][2]).toBeCloseTo(0.8, 12);
  expect(before.scalars![0].value).toBe(0); expect(after.scalars![0].value).toBeCloseTo(0.2, 12);
});

test("complex coherence and Pauli ordering survive the comparison", async () => {
  const ctx = context(2, "h q[0]; s q[0];"); ctx.noise = { ...noise, ad: 0, p1: 0.1 };
  const r = await runAnalysis("noisecompare", ctx, { obs: " i y + 2*z i " });
  const row = table(r, 0)[1];
  expect(row[1]).toBeCloseTo(3, 12); expect(row[2]).toBeCloseTo(2.81, 12);
});

test("dynamic circuits compare unconditional ensembles with all ideal rates cleared", async () => {
  const ctx = context(2, "h q[0]; cx q[0],q[1]; c[0] = measure q[0];");
  ctx.noise = { ...noise, ad: 0, readout: 0.1, trajectories: 128 };
  const r = await runAnalysis("noisecompare", ctx, { obs: "ZZ" });
  for (const row of table(r, 0)) expect(row[3]).toBeCloseTo(0, 12);
  for (const row of table(r, 1)) expect(row[3]).toBeCloseTo(0, 12);
  expect(r.provenance!.detail).toContain("128 trajectories");
  expect(r.notes!.some(x => x.includes("unconditional ensemble"))).toBe(true);
});

test("larger distributions account for omitted outcomes in both columns", async () => {
  const ctx = context(6, Array.from({ length: 6 }, (_, q) => `h q[${q}];`).join(" "));
  const r = await runAnalysis("noisecompare", ctx, { obs: "IIIIIZ" });
  const rows = table(r, 1);
  expect(rows).toHaveLength(33); expect(rows[32][0]).toBe("All other outcomes");
  expect(rows.reduce((sum, row) => sum + Number(row[1]), 0)).toBeCloseTo(1, 12);
  expect(rows.reduce((sum, row) => sum + Number(row[2]), 0)).toBeCloseTo(1, 12);
});

test("comparison rejects disabled noise and malformed Pauli lengths", async () => {
  const ctx = context(2, "x q[0];");
  expect((await runAnalysis("noisecompare", { ...ctx, noise: undefined }, {})).error).toMatch(/noise is off/);
  expect((await runAnalysis("noisecompare", ctx, { obs: "IZ + Z" })).error).toBeDefined();
});
