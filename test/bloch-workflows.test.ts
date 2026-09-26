import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runAnalysis } from "../src/analysis/run";
import { noisyView } from "../src/analysis/noiseRuns";
import { sanitiseNoise } from "../src/noise/model";
import { BlochView } from "../src/ui/views";
import { blochStateLabel } from "../src/ui/blochState";
import { calc, stateOf } from "./ed";
const noise = sanitiseNoise({ enabled: true, p1: 0, p2: 0, ad: 0.3, pd: 0, readout: 0 });
function setup(gates: string) {
  const c = calc(null, runAnalysis);
  c.loadQasm(`OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; bit[2] c; ${gates}`, "Bloch test");
  c.setMode("bloch");
  return { c, ctx: { n: 2, tape: c.tape, state: stateOf(c), scope: {}, noise } };
}

test("stepping Bell preparation shows pure initial/superposition states then maximally mixed local states", () => {
  const { c } = setup("h q[0]; cx q[0],q[1];");
  for (const step of [0, 1, 2]) {
    c.setScrub(step);
    if (c.view?.mode !== "bloch") throw new Error("Expected Bloch view");
    const html = renderToStaticMarkup(createElement(BlochView, { calc: c, data: c.view }));
    expect(html).toContain(`Step ${step}/2`);
    expect(html).toContain(step === 2 ? "Maximally mixed" : "Pure");
    expect(html).toContain("These spheres alone cannot establish entanglement");
    if (step === 1) expect(c.view.vectors[0].x).toBeCloseTo(1);
  }
  expect(c.tape).toHaveLength(2);
});

test("overlay follows the same prefix and preserves q0 ordering and reset to end", async () => {
  const { c } = setup("x q[0]; h q[1];");
  c.setNoise(noise); c.setBlochCompare(true);
  await expect.poll(() => c.noisyView?.view?.mode === "bloch" && c.noisyView.view.idealVectors?.[0].z).toBeCloseTo(-1);
  let view = c.noisyView!.view!;
  if (view.mode !== "bloch") throw new Error("Expected Bloch view");
  expect(view.vectors[0].z).toBeCloseTo(-0.4);
  expect(view.idealVectors![1].x).toBeCloseTo(1);
  const html = renderToStaticMarkup(createElement(BlochView, { calc: c, data: view }));
  expect(html).toContain('class="bloch-ideal"'); expect(html).toContain("Mixed");
  c.setScrub(0);
  await expect.poll(() => c.noisyView?.view?.at).toBe(0);
  view = c.noisyView!.view!;
  if (view.mode !== "bloch") throw new Error("Expected Bloch view");
  expect(view.idealVectors![0].z).toBe(1); expect(view.vectors[0].z).toBe(1);
  c.setScrub(null);
  await expect.poll(() => c.noisyView?.view?.at).toBeUndefined();
  expect(c.tape).toHaveLength(2);
});

test("ideal overlay clears per-gate and per-qubit noise and keeps complex coherence", async () => {
  const { ctx } = setup("h q[0]; s q[0];");
  ctx.noise = { ...noise, perQubit: [{ ad: 0.8 }], perGate: { h: 0.5 } };
  const { view } = await noisyView(ctx, { mode: "bloch", compare: true });
  if (view?.mode !== "bloch") throw new Error("Expected Bloch view");
  expect(view.idealVectors![0].y).toBeCloseTo(1); expect(view.idealVectors![1].z).toBeCloseTo(1);
  expect(view.vectors[0].y).toBeLessThan(0.5);
});

test("dynamic ideal comparison uses an ensemble, not a recorded measurement branch", async () => {
  const { ctx } = setup("h q[0]; cx q[0],q[1]; c[0] = measure q[0];");
  ctx.noise = { ...noise, ad: 0, readout: 0.1, trajectories: 256 };
  const { view } = await noisyView(ctx, { mode: "bloch", compare: true });
  if (view?.mode !== "bloch") throw new Error("Expected Bloch view");
  expect(view.idealMethod).toBe("256 trajectories");
  expect(Math.abs(view.idealVectors![0].z)).toBeLessThan(0.2);
  expect(view.idealVectors![0].z).toBeCloseTo(view.idealVectors![1].z);
});

test("sampling estimates never receive definitive pure/mixed labels", () => {
  expect(blochStateLabel(1.02, true)).toBe("Estimate outside sphere");
  expect(blochStateLabel(0, true)).toBe("Estimated vector");
  expect(blochStateLabel(1, true)).toBe("Estimated vector");
  expect(blochStateLabel(0.8, false)).toBe("Mixed");
  expect(blochStateLabel(0, false)).toBe("Maximally mixed");
  expect(blochStateLabel(1, false)).toBe("Pure");
});
