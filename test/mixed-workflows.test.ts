import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runAnalysis } from "../src/analysis/run";
import { noisyView } from "../src/analysis/noiseRuns";
import { sanitiseNoise } from "../src/noise/model";
import { KetView } from "../src/ui/views";
import { calc, stateOf } from "./ed";

const noise = sanitiseNoise({ enabled: true, p1: 0, p2: 0, ad: 0, pd: 1, readout: 0 });
function bell() {
  const c = calc(null, runAnalysis);
  c.loadQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; h q[0]; cx q[0], q[1];', "Bell");
  return { c, ctx: { n: c.n, tape: c.tape, state: stateOf(c), scope: {}, noise } };
}
const value = (r: Awaited<ReturnType<typeof runAnalysis>>, label: string) => {
  expect(r.error).toBeUndefined();
  return r.scalars!.find(s => s.label === label)!.value as number;
};

test("dephased Bell mixture: total correlation is 1 bit, coherence zero, purity one half", async () => {
  const { ctx } = bell();
  const total = await runAnalysis("totalcorr", ctx, {});
  expect(value(total, "total correlation")).toBeCloseTo(1, 10);
  expect(total.provenance?.method).toBe("Mixed-state analysis");
  const coherence = await runAnalysis("coherence", ctx, {});
  expect(value(coherence, "l₁ coherence")).toBeCloseTo(0, 10);
  expect(value(coherence, "relative-entropy coherence")).toBeCloseTo(0, 10);
  const density = await runAnalysis("density", ctx, { kept: [0, 1] });
  expect(value(density, "purity Tr ρ²")).toBeCloseTo(0.5, 10);
  expect(density.scalars!.find(s => s.label === "row / column bit order")!.value).toBe("q1 q0");
  const pureOnly = await runAnalysis("multiqfi", ctx, {});
  expect(pureOnly.error).toMatch(/assumes a pure state/);
  expect(value(await runAnalysis("totalcorr", { ...ctx, noise: undefined }, {}), "total correlation")).toBeCloseTo(2, 10);
});

test("hardware tomography uses the full mixture for coherence and total correlation", async () => {
  const { ctx } = bell();
  const sample = { shots: 12000, seed: 2 };
  expect(value(await runAnalysis("totalcorr", ctx, {}, sample), "total correlation")).toBeCloseTo(1, 1);
  expect(value(await runAnalysis("coherence", ctx, {}, sample), "relative-entropy coherence")).toBeLessThan(0.02);
});

test("STATE shows matrix and purity by default, with a labeled optional degenerate component", async () => {
  const { c, ctx } = bell();
  const result = await noisyView(ctx, { mode: "ket" });
  expect(result.view?.mode).toBe("ket");
  const view = result.view!;
  if (view.mode !== "ket") throw new Error("expected STATE");
  expect(view.density!.purity).toBeCloseTo(0.5, 10);
  expect(view.density!.rho[0]).toBeCloseTo(0.5, 10);
  expect(view.density!.rho[30]).toBeCloseTo(0.5, 10);
  expect(view.density!.degenerate).toBe(true);
  const html = renderToStaticMarkup(createElement(KetView, { calc: c, data: view }));
  expect(html).toContain("Density matrix ρ");
  expect(html).toContain("q1 q0");
  expect(html).toContain("<details>");
  expect(html).toContain("not the full mixed state");
  const sampled = await noisyView(ctx, { mode: "ket", estimate: true, shots: 10000, seed: 1 });
  expect(sampled.view!.provenance?.method).toBe("Density-matrix tomography");
  expect(sampled.view!.density!.purity).toBeCloseTo(0.5, 1);
  c.setNoise(noise); c.setMode("ket");
  expect(c.noisyMode).toBe(true);
  await expect.poll(() => c.noisyView?.view?.density?.purity).toBeCloseTo(0.5, 10);
});

test("noisy STATE and full tomography report explicit size limits", async () => {
  const { ctx } = bell();
  expect((await noisyView({ ...ctx, n: 9 }, { mode: "ket" })).error).toMatch(/up to 8/);
  expect((await noisyView({ ...ctx, n: 7 }, { mode: "ket", estimate: true })).error).toMatch(/up to 6/);
});

test("reduced density labels map nonadjacent qubits to the correct matrix indices", async () => {
  const c = calc(null, runAnalysis);
  c.loadQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; x q[0];', "asymmetric");
  c.setNoise({ enabled: true, p1: 0.2, p2: 0, ad: 0, pd: 0, readout: 0 });
  c.setLabOpts("density", { kept: [0, 2] }); c.setMode("lab"); c.openAnalysis("density");
  await expect.poll(() => c.analysis?.status).toBe("done");
  const r = c.analysis!.result!;
  expect(r.scalars!.find(s => s.label === "row / column bit order")!.value).toBe("q2 q0");
  const chart = r.charts![0];
  if (chart.kind !== "heatmap") throw new Error("expected density heatmap");
  expect(chart.rows).toEqual(["00", "01", "10", "11"]);
  expect(chart.values[1][1]).toBeCloseTo(0.9, 12);
  expect(chart.values[2][2]).toBeCloseTo(0, 12);
});

test("noisy probability panels keep finite-shot data rather than recomputing exact probabilities", async () => {
  const c = calc();
  c.loadQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; h q[0];', "plus");
  const r = await runAnalysis("symmetry", { n: 1, tape: c.tape, state: stateOf(c), scope: {}, noise }, {}, { shots: 3, seed: 1 });
  expect(r.error).toBeUndefined();
  const chart = r.charts!.find(c => c.kind === "bars")!;
  for (const p of chart.values) expect(p * 3).toBeCloseTo(Math.round(p * 3), 12);
  expect(r.provenance?.method).toBe("Sampled Z measurements");
});
