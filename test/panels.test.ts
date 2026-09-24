/**
 * Panel-level scientific checks from the external review of the remaining
 * LAB analyses (bugs #42–#49 and the benchmark fixes): each finding's
 * counterexample through the analysis entry point, plus a control.
 */
import { describe, test, expect } from "vitest";
import { runAnalysis } from "../src/analysis/run";
import { Register } from "../src/calc/register";
import { lowerTape } from "../src/calc/lower";
import { sanitiseNoise } from "../src/noise/model";
import { decayOrIdeal, fitDecay, rb, t1t2, unitarity, xeb } from "../src/noise/bench";
import { majoranaStars } from "../src/sim/majoranaStars";
import { computeLightCone } from "../src/sim/lightcone";
import { barrenPlateauDiagnostic, checkedGradient, optimizeExpectation } from "../src/sim/optimize";
import { quantumGeometricTensor } from "../src/sim/qgt";
import type { Entry, Step } from "../src/calc/steps";

let sid = 0;
const step = (gateId: string, targets = [0], params: string[] = [], controls: number[] = [], extra: Partial<Step> = {}): Step =>
  ({ id: `p${sid++}`, gateId, column: 0, targets, params, controls, clbits: [], ...extra });
const ctx = (n: number, tape: Entry[] = [], scope: Record<string, number> = {}, noise?: ReturnType<typeof sanitiseNoise>) =>
  ({ n, tape, scope, state: new Register(n, tape, scope).state, noise });
const zero = sanitiseNoise({ enabled: true, p1: 0, p2: 0, ad: 0, pd: 0, readout: 0, crosstalk: 0, trajectories: 2048 });
const val = (r: Awaited<ReturnType<typeof runAnalysis>>, label: string) => r.scalars?.find((s) => s.label.includes(label))?.value;

describe("benchmarks: flat curves, the interleaved gate, tomography's symbols", () => {
  test("noiseless RB, unitarity, T1/T2 and XEB read the ideal limit, not an arbitrary fit", () => {
    const r = rb(zero), u = unitarity(zero), t = t1t2(zero);
    expect(r.identifiable).toBe(false);
    expect(r.p).toBe(1);
    expect(r.epc).toBe(0);
    expect(u.u).toBe(1);
    expect(t.T1).toBe(Infinity);
    expect(t.T2).toBe(Infinity);
    expect(t.T2echo).toBe(Infinity);
    expect(xeb(zero, { n: 2 }).perCycle).toBeCloseTo(1, 12); // not flat (an uninformative depth reads 0), fitted p = 1
  });

  test("a flat curve away from its ideal value is not identifiable (NaN), and says so in the panel", async () => {
    expect(decayOrIdeal(fitDecay([1, 2, 4], [0.5, 0.5, 0.5]), 1)).toBeNaN();
    const res = await runAnalysis("rb", ctx(1, [], {}, zero), {});
    expect(res.notes?.join(" ")).toMatch(/flat/);
  });

  test("interleaved X runs X itself, so its own 20% depolarizing gives error λ/2 = 0.1", async () => {
    const m = { ...zero, perGate: { x: 0.2 } };
    const raw = rb(m, { interleave: "x" });
    expect(new Set(raw.sequences.flat(3).map((s) => s.gateId)).has("x")).toBe(true);
    const res = await runAnalysis("rb", ctx(1, [], {}, m), { interleave: 1 });
    expect(Number(val(res, "error of X"))).toBeCloseTo(0.1, 6);
  });

  test("process tomography of RY(θ) at θ = π equals that of RY(π)", async () => {
    const sym = await runAnalysis("tomography", ctx(1, [[step("ry", [0], ["theta"])]], { theta: Math.PI }), {});
    const lit = await runAnalysis("tomography", ctx(1, [[step("ry", [0], ["pi"])]]), {});
    expect(sym.charts).toEqual(lit.charts);
    const R = (sym.charts![0] as { values: number[][] }).values;
    expect(R.map((row, i) => Math.round(row[i]))).toEqual([1, -1, 1, -1]);
  });

  test("unitarity's note states u ≥ p² (equality for depolarizing)", async () => {
    const res = await runAnalysis("unitarity", ctx(1, [], {}, sanitiseNoise({ ...zero, p1: 0.05 })), {});
    const text = JSON.stringify(res);
    expect(text).not.toContain("u < p²: incoherent");
    expect(text).toContain("u ≥ p²");
  });
});

describe("classical shadows: one standard error for the whole sum", () => {
  test("X + X and 2X agree to the digit; X − X is 0 ± 0", async () => {
    const c = ctx(1, [[step("h")]]);
    const a = await runAnalysis("shadows", c, { obs: "X + X" }), b = await runAnalysis("shadows", c, { obs: "2 X" });
    const d = await runAnalysis("shadows", c, { obs: "X - X" });
    expect(a.scalars?.[0].value).toEqual(b.scalars?.[0].value);
    expect(String(d.scalars?.[0].value)).toMatch(/± 0\.0000$/);
  });
});

describe("noise panels compare like with like", () => {
  const measured: Entry[] = [[step("h")], [step("measure", [0], [], [], { outcome: 0 })]];
  test("zero noise on a measured circuit: fidelity 1, trace distance 0 (the ensemble against the ensemble)", async () => {
    const r = await runAnalysis("impact", ctx(1, measured, {}, zero), {});
    expect(Number(val(r, "fidelity"))).toBeCloseTo(1, 12);
    expect(Number(val(r, "trace distance"))).toBeCloseTo(0, 12);
    expect(r.notes?.join(" ")).toMatch(/unconditional ensemble/);
  });

  test("zero noise: noisy and ideal coherence agree after a measurement", async () => {
    const r = await runAnalysis("noisycoherence", ctx(1, [...measured, [step("h")]], {}, zero), {});
    expect(val(r, "l1 coherence (noisy)")).toEqual(val(r, "l1 coherence (ideal)"));
  });

  test("control: a unitary circuit still compares with the pure ideal state", async () => {
    const r = await runAnalysis("impact", ctx(1, [[step("h")]], {}, zero), {});
    expect(Number(val(r, "fidelity"))).toBeCloseTo(1, 12);
    expect(r.notes?.join(" ")).not.toMatch(/unconditional/);
  });
});

describe("derivative-based panels resolve fast angles", () => {
  test("barren-plateau variance of RY(2000π·θ), Z over θ ∈ [−π, π] is about a²/2", async () => {
    const c = lowerTape(1, [[step("ry", [0], ["2000*pi*theta"])]]);
    const r = await barrenPlateauDiagnostic(c, [], { kind: "sum", terms: [{ coefficient: 1, paulis: "Z" }] }, ["theta"], 200);
    const want = (2000 * Math.PI) ** 2 / 2;
    expect(r.variancePerSymbol[0] / want).toBeGreaterThan(0.7);
    expect(r.variancePerSymbol[0] / want).toBeLessThan(1.3);
    expect(r.unresolvedPerSymbol[0]).toBe(0);
  });

  test("the optimiser doesn't certify the maximum of RY(20000π·θ) as converged when minimising", async () => {
    const c = lowerTape(1, [[step("ry", [0], ["20000*pi*theta"])]]);
    const r = await optimizeExpectation(c, [], {
      symbols: ["theta"], observable: { kind: "sum", terms: [{ coefficient: 1, paulis: "Z" }] }, initial: { theta: 0 },
      steps: 20, learningRate: 0.1, epsilon: 1e-4, goal: "minimize", optimizer: "sgd",
    });
    expect(r.stopped === "converged" && r.finalValue > 0.99).toBe(false);
  });

  test("control: a slow angle still converges to the minimum", async () => {
    const c = lowerTape(1, [[step("ry", [0], ["theta"])]]);
    const r = await optimizeExpectation(c, [], {
      symbols: ["theta"], observable: { kind: "sum", terms: [{ coefficient: 1, paulis: "Z" }] }, initial: { theta: 0.3 },
      steps: 400, learningRate: 0.3, epsilon: 1e-4, goal: "minimize", optimizer: "sgd",
    });
    expect(r.stopped).toBe("converged");
    expect(r.finalValue).toBeCloseTo(-1, 6);
  });
});

describe("state panels", () => {
  test("the singlet has no Majorana constellation; a symmetric state keeps its stars", async () => {
    const singlet = new Float64Array([0, 0, Math.SQRT1_2, 0, -Math.SQRT1_2, 0, 0, 0]);
    expect(majoranaStars(singlet, 2)!.stars).toEqual([]);
    const ui = await runAnalysis("majorana", { n: 2, tape: [], scope: {}, state: singlet }, {});
    expect(ui.notes?.join(" ")).toMatch(/No constellation/);
    expect(majoranaStars(new Float64Array([0, 0, 0, 0, 0, 0, 1, 0]), 2)!.stars).toHaveLength(2); // |11⟩: two south-pole stars
  });

  test("X|0⟩ has a definite number and parity; the panel doesn't call it a conservation law", async () => {
    const r = await runAnalysis("symmetry", ctx(1, [[step("x")]]), {});
    expect(val(r, "definite excitation number")).toBe("yes");
    expect(JSON.stringify(r.scalars)).not.toMatch(/conserved/);
  });

  test("uncomputed Schmidt / MPS cuts on 18 qubits are shown as missing, not 0", async () => {
    const state = new Float64Array(2 * (1 << 18)); state[0] = 1;
    const c = { n: 18, tape: [], scope: {}, state };
    const gap = await runAnalysis("schmidtgap", c, {}), mps = await runAnalysis("mps", c, {});
    expect((gap.charts![0] as { values: number[] }).values[8]).toBeNaN();
    expect((mps.charts![0] as { values: number[] }).values[8]).toBeNaN();
    expect(mps.scalars?.[0].label).toMatch(/computed cuts/);
  }, 60000);
});

describe("causal structure", () => {
  test("measure q0 → IF c[0] X q1: the measurement is in q1's backward cone, and X is in q0's forward cone", () => {
    const c = lowerTape(2, [[step("measure", [0], [], [], { outcome: 0 })], [step("x", [1], [], [], { condition: { clbit: 0, value: 1 } })]]);
    expect(computeLightCone(c, 1, "backward").has(c.gates[0].id)).toBe(true);
    expect(computeLightCone(c, 0, "forward").has(c.gates[1].id)).toBe(true);
  });

  test("control: without the condition, q0's measurement stays out of q1's cone", () => {
    const c = lowerTape(2, [[step("measure", [0], [], [], { outcome: 0 })], [step("x", [1])]]);
    expect(computeLightCone(c, 1, "backward").has(c.gates[0].id)).toBe(false);
  });
});

// Boundary review: a flat curve isn't proof of no noise; a derivative isn't resolved just because it's consistent.

describe("flat benchmark curves read 'no decay' only when the model has no noise on those gates", () => {
  test("complete amplitude damping (ad = 1) keeps survival and purity at 1, but isn't reported as ideal", async () => {
    const m = sanitiseNoise({ ...zero, ad: 1 });
    const r = rb(m), u = unitarity(m), t = t1t2(m);
    expect(r.survival.every((x) => Math.abs(x - 1) < 1e-12)).toBe(true);
    expect(r.p).toBeNaN();
    expect(u.u).toBeNaN();
    expect(t.T1).not.toBe(Infinity); // P(1) after X is 0 at every delay: flat, not "no relaxation"
    const res = await runAnalysis("unitarity", ctx(1, [], {}, m), {});
    expect(res.notes?.join(" ")).toMatch(/isn't identifiable/);
  });

  test("per-qubit overrides: ad = 1 on the benchmarked qubit is noise; on another qubit it isn't", () => {
    expect(rb(sanitiseNoise({ ...zero, perQubit: [{ p1: 0, ad: 1, pd: 0, readout: 0 }] })).p).toBeNaN();
    expect(rb(sanitiseNoise({ ...zero, perQubit: [{ p1: 0, ad: 0, pd: 0, readout: 0 }, { p1: 0, ad: 1, pd: 0, readout: 0 }] })).p).toBe(1);
  });
});

describe("derivatives at large parameter values: resolved means accurate", () => {
  const ry = lowerTape(1, [[step("ry", [0], ["theta"])]]);
  const Z = { kind: "sum" as const, terms: [{ coefficient: 1, paulis: "Z" }] };
  test.each([Math.PI, 3, 1e3, 1e6, 1e8, 1e10, 1e12, 1e15])("RY(θ), ⟨Z⟩ at θ = %s: flagged, or within 1e-5 of −sin θ", (theta) => {
    const r = checkedGradient(ry, [], { theta }, Z, "theta", 1e-4);
    if (r.resolved) expect(Math.abs(r.g + Math.sin(theta))).toBeLessThan(1e-5);
    if (theta >= 1e12) expect(r.resolved).toBe(false); // the review's cases: g = 0 "resolved" at 10¹²
  });

  test("controls stay resolved: the zero gradient at θ = π, and ordinary points", () => {
    for (const theta of [Math.PI, 0.3, -2]) expect(checkedGradient(ry, [], { theta }, Z, "theta", 1e-4).resolved).toBe(true);
  });

  test("SGD from θ = 10¹² doesn't certify convergence; the QGT at 10¹⁵ is flagged", async () => {
    const r = await optimizeExpectation(ry, [], {
      symbols: ["theta"], observable: Z, initial: { theta: 1e12 }, steps: 5, learningRate: 0.1, epsilon: 1e-4, goal: "minimize", optimizer: "sgd",
    });
    expect(r.stopped).not.toBe("converged");
    expect(quantumGeometricTensor(ry, [], { theta: 1e15 }, ["theta"])!.unresolved).toEqual(["theta"]);
  });
});
