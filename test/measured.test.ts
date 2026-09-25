import { describe, test, expect } from "vitest";
import { runAnalysis } from "../src/analysis/run";
import { Register } from "../src/calc/register";
import { calc, add, cx } from "./ed";
import { sanitiseNoise, readoutPair } from "../src/noise/model";
import { basisSuperop, measurementDevice } from "../src/noise/sim";
import { confusion, drawCounts, mitigateCounts, qubitP1 } from "../src/calc/tomography";
import { shotRng } from "../src/calc/estimate";
import type { AnalysisResult } from "../src/analysis/types";

/** A LAB panel on a run's measurements (SHOTS → repeat). */
async function measured(id: string, n: number, build: (c: ReturnType<typeof calc>) => void, shots: number, opts = {}, noise?: ReturnType<typeof sanitiseNoise>, mitigate = false): Promise<AnalysisResult> {
  const c = calc();
  c.setQubitCount(n);
  build(c);
  const state = new Register(n, c.tape).state;
  return runAnalysis(id, { n, state, tape: c.tape, scope: {}, noise }, opts, { shots, seed: 5, mitigate });
}
const scalar = (r: AnalysisResult, label: string) => r.scalars!.find((s) => s.label === label)!;
const bell = (c: ReturnType<typeof calc>, a = 0, b = 1) => { add(c, "h", [a]); cx(c, a, b); };

describe("LAB on measurements: mixed ρ, local tomography, bootstrap", () => {
  test("the density panel sees the measured mixed ρ̂ (purity < 1 under noise), not a pure state", async () => {
    const noise = sanitiseNoise({ enabled: true, p1: 0.1, p2: 0.2, ad: 0, pd: 0, readout: 0 });
    const r = await measured("density", 2, (c) => bell(c), 4000, { kept: [0, 1] }, noise);
    expect(r.error).toBeUndefined();
    expect(r.notes?.[0]).toMatch(/^Measured by state tomography/);
    expect(scalar(r, "purity Tr ρ²").value as number).toBeLessThan(0.9);
    const ideal = await measured("density", 2, (c) => bell(c), 4000, { kept: [0, 1] });
    expect(scalar(ideal, "purity Tr ρ²").value as number).toBeGreaterThan(0.95);
  });

  test("above 6 qubits, local tomography measures the pairs: a Bell pair across q0, q6 has I ≈ 2 bits", async () => {
    const r = await measured("mutualinfo", 7, (c) => bell(c, 0, 6), 3000);
    expect(r.error).toBeUndefined();
    expect(r.notes?.[0]).toMatch(/^Measured by local tomography/);
    const mi = (r.charts![0] as { values: number[][] }).values;
    expect(mi[0][6]).toBeGreaterThan(1.8);
    expect(mi[0][3]).toBeLessThan(0.1);
  }, 60_000);

  test("with noise above 10 qubits, local panels measure trajectory-averaged ρ; too much work says so", async () => {
    const noise = sanitiseNoise({ enabled: true, p1: 0.05, p2: 0.1, ad: 0, pd: 0, readout: 0, trajectories: 64 });
    const r = await measured("density", 12, (c) => bell(c, 0, 11), 3000, { kept: [0, 11] }, noise);
    expect(r.error).toBeUndefined();
    expect(r.notes?.[0]).toMatch(/its state from 64 noise trajectories/);
    expect(scalar(r, "purity Tr ρ²").value as number).toBeLessThan(0.95);
    const big = await measured("density", 16, (c) => bell(c, 0, 15), 100, { kept: [0, 1, 2, 3, 4, 15] }, noise); // 4⁶ entries per trajectory on 2¹⁶ amplitudes
    expect(big.error).toMatch(/^Too large to measure with noise here/);
  }, 120_000);

  test("state panels still say not measurable above 6 qubits", async () => {
    const r = await measured("renyi", 7, (c) => bell(c), 100);
    expect(r.error).toMatch(/^Not measurable at this size/);
  });

  test("scalars get bootstrap error bars, smaller with more shots", async () => {
    const few = await measured("density", 1, (c) => add(c, "ry", [0], { params: ["1.1"] }), 200, { kept: [0] });
    const many = await measured("density", 1, (c) => add(c, "ry", [0], { params: ["1.1"] }), 20000, { kept: [0] });
    const e1 = scalar(few, "purity Tr ρ²").err!, e2 = scalar(many, "purity Tr ρ²").err!;
    expect(e1).toBeGreaterThan(0);
    expect(e2).toBeLessThan(e1 / 3);
    expect(few.notes?.some((x) => /bootstrap spread/.test(x))).toBe(true);
  });
});

describe("the device: noisy basis changes and asymmetric readout", () => {
  test("measuring X goes through a noisy H: depolarizing λ shrinks ⟨X⟩ of |+⟩ by (1 − λ)", () => {
    const m = sanitiseNoise({ enabled: true, p1: 0.2, p2: 0, ad: 0, pd: 0, readout: 0 });
    const dev = { readout: [], superops: [[basisSuperop(m, 0, 0), basisSuperop(m, 0, 1), basisSuperop(m, 0, 2)]] };
    const p1 = qubitP1({ x: 1, y: 0, z: 0 }, 0, 0, dev);
    expect(1 - 2 * p1).toBeCloseTo(0.8, 12);
    // Y goes through S† then H: two noisy gates.
    expect(1 - 2 * qubitP1({ x: 0, y: 1, z: 0 }, 0, 1, dev)).toBeCloseTo(0.64, 12);
    // Z: no gate, no loss.
    expect(1 - 2 * qubitP1({ x: 0, y: 0, z: 1 }, 0, 2, dev)).toBeCloseTo(1, 12);
  });

  test("asymmetric readout: P(0|1) defaults to P(1|0); a set readout10 is used; per-qubit overrides win", () => {
    expect(readoutPair(sanitiseNoise({ enabled: true, readout: 0.03 }), 0)).toEqual([0.03, 0.03]);
    const m = sanitiseNoise({ enabled: true, readout: 0.02, readout10: 0.1, perQubit: [{}, { readout: 0.01, readout10: 0.3 }] });
    expect(readoutPair(m, 0)).toEqual([0.02, 0.1]);
    expect(readoutPair(m, 1)).toEqual([0.01, 0.3]);
    expect(measurementDevice(m, 2).readout).toEqual([[0.02, 0.1], [0.01, 0.3]]);
  });

  test("a |1⟩ is misread at P(0|1), a |0⟩ at P(1|0); mitigation undoes the confusion", () => {
    const readout: [number, number][] = [[0.02, 0.2]];
    const ones = drawCounts(Float64Array.of(0, 1), 50000, shotRng(1), readout);
    expect((ones.get(0) ?? 0) / 50000).toBeCloseTo(0.2, 2);
    const zeros = drawCounts(Float64Array.of(1, 0), 50000, shotRng(2), readout);
    expect((zeros.get(1) ?? 0) / 50000).toBeCloseTo(0.02, 2);
    // The confusion and its inverse are exact inverses.
    const p = Float64Array.of(0.3, 0.7), back = confusion(confusion(p, 1, readout, false), 1, readout, true);
    expect(back[0]).toBeCloseTo(0.3, 14);
    expect(back[1]).toBeCloseTo(0.7, 14);
    const fixed = mitigateCounts(ones, 1, readout);
    expect((fixed.get(1) ?? 0) / 50000).toBeCloseTo(1, 2);
  });
});
