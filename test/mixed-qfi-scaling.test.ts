import { expect, test } from "vitest";
import { quantumFisherMixed, quantumFisherPure, collectiveSpinGenerator } from "../src/sim/qfi";
import { reducedDensityMatrix } from "../src/sim/density";
import { runAnalysis } from "../src/analysis/run";
import { sanitiseNoise } from "../src/noise/model";
import { calc, stateOf } from "./ed";
const noise = sanitiseNoise({ enabled: true, p1: 0, p2: 0, ad: 0, pd: 1, readout: 0, trajectories: 64 });
const scalar = (r: Awaited<ReturnType<typeof runAnalysis>>, label: string) => {
  expect(r.error).toBeUndefined();
  return r.scalars!.find(s => s.label === label)!.value as number;
};

test("mixed QFI vanishes for maximally mixed states despite nonzero variance", () => {
  const rho = [[{ re: 0.5, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: 0.5, im: 0 }]];
  for (const axis of ["X", "Y", "Z"] as const) {
    const r = quantumFisherMixed(rho, 1, collectiveSpinGenerator(1, axis));
    expect(r.qfi).toBeCloseTo(0, 12); expect(r.variance).toBeCloseTo(0.25, 12);
    expect(r.witnessesEntanglement).toBe(false);
  }
});

test("mixed qubit QFI equals squared Bloch length perpendicular to the rotation axis", () => {
  // r=(0.3,0.4,0.2), includes complex coherence and unequal populations.
  const rho = [[{ re: 0.6, im: 0 }, { re: 0.15, im: -0.2 }], [{ re: 0.15, im: 0.2 }, { re: 0.4, im: 0 }]];
  for (const [axis, expected] of [["X", 0.2], ["Y", 0.13], ["Z", 0.25]] as const) {
    expect(quantumFisherMixed(rho, 1, collectiveSpinGenerator(1, axis)).qfi).toBeCloseTo(expected, 11);
  }
});

test("mixed QFI reduces to the pure formula for an asymmetric complex entangled state", () => {
  const c = calc(); c.loadQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; ry(0.73) q[0]; cx q[0],q[2]; s q[2]; rx(0.41) q[1];', "complex");
  const state = stateOf(c), rho = reducedDensityMatrix(state, 3, [0, 1, 2]);
  for (const axis of ["X", "Y", "Z"] as const) {
    const g = collectiveSpinGenerator(3, axis), r = quantumFisherMixed(rho, 3, g), p = quantumFisherPure(state, 3, g);
    expect(r.qfi).toBeCloseTo(p.qfi, 10); expect(r.expG).toBeCloseTo(p.expG, 10); expect(r.expG2).toBeCloseTo(p.expG2, 10);
  }
});

test("LAB QFI distinguishes a dephased Bell mixture from the pure Bell state and supports tomography", async () => {
  const c = calc(); c.loadQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; h q[0]; cx q[0],q[1];', "Bell");
  const ctx = { n: 2, state: stateOf(c), tape: c.tape, scope: {} };
  expect(scalar(await runAnalysis("qfi", ctx, { axis: 2 }), "F_Q (Jz)")).toBeCloseTo(4, 10);
  const mixed = { ...ctx, noise };
  expect(scalar(await runAnalysis("qfi", mixed, { axis: 2 }), "F_Q (Jz)")).toBeCloseTo(0, 10);
  expect(scalar(await runAnalysis("qfi", mixed, { axis: 2 }, { shots: 15000, seed: 1 }), "F_Q (Jz)")).toBeLessThan(0.02);
  expect((await runAnalysis("qfi", { ...mixed, n: 7 }, {})).error).toMatch(/up to 6/);
});

test("12-qubit local density keeps a distant Bell pair, including measurement branches", async () => {
  const c = calc(); c.loadQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[12] q; bit[12] c; h q[0]; cx q[0],q[11]; c[5] = measure q[0];', "distant pair");
  const ctx = { n: 12, tape: c.tape, state: stateOf(c), scope: {}, noise };
  const r = await runAnalysis("density", ctx, { kept: [0, 11] });
  expect(scalar(r, "purity Tr ρ²")).toBeGreaterThanOrEqual(0.5);
  expect(scalar(r, "purity Tr ρ²")).toBeLessThan(0.6);
  expect(r.provenance?.method).toBe("Trajectory approximation");
  expect(r.provenance?.detail).toContain("64 trajectories");
  expect(r.provenance?.detail).toContain("uncertainty is not included");
  const chart = r.charts![0]; if (chart.kind !== "heatmap") throw new Error("density plot");
  expect(chart.values[1][1]).toBe(0); expect(chart.values[2][2]).toBe(0);
  expect(chart.values[0][0] + chart.values[3][3]).toBeCloseTo(1, 12);
  expect(r.scalars!.find(s => s.label === "row / column bit order")!.value).toBe("q11 q0");
});

test("local density enforces kept-size and trajectory work budgets without falling back to purity", async () => {
  const c = calc(); c.setQubitCount(16);
  const ctx = { n: 16, tape: c.tape, state: stateOf(c), scope: {}, noise };
  expect((await runAnalysis("density", ctx, { kept: [0, 1, 2, 3, 4, 5, 6] })).error).toMatch(/at most 6/);
  expect((await runAnalysis("density", ctx, { kept: [0, 1, 2, 3, 4, 5] })).error).toMatch(/work budget/);
  expect((await runAnalysis("density", { ...ctx, noise: { ...noise, trajectories: 8 } }, { kept: [0] })).error).toMatch(/16 needed/);
});
