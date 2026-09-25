import { describe, test, expect } from "vitest";
import type { Entry } from "../../src/calc/steps";
import { noisyDensity, runTrajectories } from "../../src/noise/sim";
import { models } from "../../validation/cases/groups/noise";
import { compute as computeNa } from "../../validation/cases/groups/noiseAnalyses";
import { importIbmBackend, dampingInfidelity } from "../../src/noise/ibm";
import { loadFixture } from "./fixtures";

// References: qiskit_aer.noise errors applied as Kraus maps to a DensityMatrix
// (exact), and AerSimulator with a NoiseModel (5σ) — validation/ref/g_noise.py.
type U = { kind: "unitary"; n: number; tape: Entry[]; model: string; rho: { re: number[]; im: number[] } };
type C = { kind: "classical"; n: number; tape: Entry[]; model: string; aer: Record<string, number>; shots: number };
const fx = loadFixture<U | C>("noise");

describe(`noise (vs ${fx.meta.reference})`, () => {
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const m = models(c.n)[c.model];
    if (c.kind === "unitary") {
      const { rho } = noisyDensity(c.n, c.tape, {}, m);
      let err = 0;
      c.rho.re.forEach((re, i) => (err = Math.max(err, Math.abs(rho[2 * i] - re), Math.abs(rho[2 * i + 1] - c.rho.im[i]))));
      expect(err).toBeLessThan(1e-10);
    } else {
      const T = 20000;
      const counts = new Map<string, number>();
      runTrajectories(c.n, c.tape, {}, m, (_s, bits) => { const k = [...bits].reverse().join(""); counts.set(k, (counts.get(k) ?? 0) + 1); }, { trajectories: T, seed: 99 });
      for (const key of new Set([...counts.keys(), ...Object.keys(c.aer)])) {
        const fa = c.aer[key] ?? 0, fq = (counts.get(key) ?? 0) / T, p = (fa + fq) / 2;
        expect(Math.abs(fa - fq), key).toBeLessThan(5 * Math.sqrt(Math.max(p * (1 - p), 1e-6) * (1 / c.shots + 1 / T)) + 2e-3);
      }
    }
  });
});

type Na = { n: number; tape: Entry[]; model: string; obs: string; cut: number[]; impact: number[]; zne: number[] };
const na = loadFixture<Na>("noise-analyses");

describe(`noise analyses (vs ${na.meta.reference})`, () => {
  test.each(na.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const r = computeNa({ id: c.id, n: c.n, tape: c.tape, model: c.model, obs: c.obs, cut: c.cut });
    const imp = r.impact as Record<string, number>;
    expect([imp["fidelity ⟨ψ|ρ|ψ⟩"], imp["trace distance"], imp["purity Tr ρ²"], imp["entropy S(ρ)"]].map((x, i) => Math.abs(x - c.impact[i]))
      .every((d) => d < 1e-9)).toBe(true);
    const z = r.zne as Record<string, { value: number }>;
    expect(Math.abs(z.linear.value - c.zne[0])).toBeLessThan(1e-8);
    expect(Math.abs(z.richardson.value - c.zne[1])).toBeLessThan(1e-8);
    expect(Math.abs(z.exponential.value - c.zne[2])).toBeLessThan(1e-8);
    // PEC: noise then its quasi-probabilistic inverse gives the ideal ρ back.
    const d = 1 << c.n, st = r.idealState;
    let err = 0;
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
      err = Math.max(err, Math.abs(r.pecRho[2 * (i * d + j)] - (st[2 * i] * st[2 * j] + st[2 * i + 1] * st[2 * j + 1])));
    }
    expect(err).toBeLessThan(1e-10);
  });

  test("calibration import: relaxation infidelity closed form, T2 ≥ 2T1 gives no extra dephasing", () => {
    expect(dampingInfidelity(0, 0)).toBe(0);
    const m = importIbmBackend(JSON.stringify({
      qubits: [[{ name: "T1", value: 100e-6 }, { name: "T2", value: 200e-6 }, { name: "readout_error", value: 0.01 }]],
      gates: [{ gate: "sx", qubits: [0], parameters: [{ name: "gate_error", value: 3e-4 }, { name: "gate_length", value: 35e-9 }] }],
    }));
    expect(m.perQubit![0].pd).toBeCloseTo(0, 12);
    expect(m.perQubit![0].ad).toBeCloseTo(1 - Math.exp(-35e-9 / 100e-6), 15);
  });
});
