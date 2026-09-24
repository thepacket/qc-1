/**
 * Scientific checks from an external validation review: each defect's
 * counterexample, plus the invariant that would have caught it (global-phase
 * covariance, eigenpair residuals, Nyquist endpoint, one orientation for
 * Berry phase / Chern flux / QGT curvature, periodicity).
 */
import { describe, test, expect } from "vitest";
import { importQasm } from "../src/qasm/import";
import { setCustomGates } from "../src/calc/custom";
import { lowerTape } from "../src/calc/lower";
import { Register } from "../src/calc/register";
import { runAnalysis } from "../src/analysis/run";
import { ANALYSIS_BY_ID } from "../src/analysis/catalog";
import { floquetSpectrum } from "../src/sim/floquetSpectrum";
import { tSweepSpectrum } from "../src/sim/tsweep";
import { temporalAutocorrelation } from "../src/sim/autocorrelation";
import { chernNumber } from "../src/sim/chernNumber";
import { berryPhase } from "../src/sim/berryPhase";
import { quantumGeometricTensor } from "../src/sim/qgt";
import { entanglementContour } from "../src/sim/entanglementContour";
import { diagonalEnsemble } from "../src/sim/diagonalEnsemble";
import { effectiveTemperature, energyMatchedBeta } from "../src/sim/effectiveTemperature";
import { lyapunovExponent } from "../src/sim/lyapunov";
import { matrixGate } from "../src/calc/typed";
import { correlationLength } from "../src/sim/correlationLength";
import { krylovComplexity } from "../src/sim/krylov";
import { randomUnitary, rng, withSpectrum } from "./unitaries";
import { hamiltonianSpectrum } from "../src/sim/hamSpectrum";
import { ethOffDiagonal } from "../src/sim/ethOffDiagonal";
import { eigenstateEntanglement } from "../src/sim/eigenstateEntanglement";
import { workDistribution } from "../src/sim/workDistribution";
import { levelStatistics } from "../src/sim/levelStatistics";
import { spectralFormFactor } from "../src/sim/spectralFormFactor";
import { densityOfStates } from "../src/sim/densityOfStates";
import type { PauliTerm } from "../src/sim/trotter";

function make(n: number, body: string, scope: Record<string, number> = {}) {
  const parsed = importQasm(`OPENQASM 3.0; include "stdgates.inc"; qubit[${n}] q; ${body}`);
  setCustomGates(parsed.gates);
  const reg = new Register(n, parsed.tape, scope);
  return { circ: lowerTape(n, reg.tape), ctx: { n, tape: reg.tape, scope, state: reg.state } };
}
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

describe("OTOC family refuses non-unitary circuits", () => {
  test.each(["otoc", "otoccone", "butterfly", "lyapunov", "opweight", "autocorr"])("%s", async (id) => {
    const { ctx } = make(2, "rx(t) q[0]; reset q[0];", { t: 0.3 });
    const r = await runAnalysis(id, ctx, { w: 0, v: 1, q: 0 });
    expect(r.error).toMatch(/isn't unitary/);
  });
});

describe("Floquet spectrum", () => {
  test("two phases that one Hermitian combination merges stay distinct (review counterexample)", () => {
    const delta = Math.atan(0.1 + Math.PI / 100);
    const r = floquetSpectrum(make(1, `gphase(${delta}); rx(1.4) q[0];`).circ, {}, [])!;
    const [a, b] = sorted(r.quasiEnergies);
    expect(a).toBeCloseTo(delta - 0.7, 10);
    expect(b).toBeCloseTo(delta + 0.7, 10);
    expect(r.residual).toBeLessThan(1e-10);
  });

  test("a global phase shifts every quasi-energy and changes no statistic; residuals stay tiny", () => {
    const body = "h q[0]; cx q[0],q[1]; rz(0.37) q[1]; ry(1.1) q[2]; cx q[1],q[2]; t q[0]; rxx(0.8) q[0],q[2];";
    const base = floquetSpectrum(make(3, body).circ, {}, [])!;
    for (const g of [0.5, Math.atan(0.1 + Math.PI / 100), 2, -2.9]) {
      const r = floquetSpectrum(make(3, `${body} gphase(${g});`).circ, {}, [])!;
      expect(r.residual).toBeLessThan(1e-9);
      expect(sorted(r.quasiEnergies.map((x) => wrap(x - g)))).toEqual(sorted(base.quasiEnergies).map((x) => expect.closeTo(x, 9)));
      expect(r.meanR).toBeCloseTo(base.meanR, 10);
    }
  });

  test("degenerate unitaries (Z⊗Z, a controlled phase, identity) decompose exactly", () => {
    for (const body of ["z q[0]; z q[1];", "cp(0.9) q[0],q[1];", "id q[0];"]) {
      const r = floquetSpectrum(make(2, body).circ, {}, [])!;
      expect(r.residual).toBeLessThan(1e-10);
    }
  });

  test("circular gap ratio uses every cyclic pair: p(0.7) ⊗ p(2) gives 0.3669092229 at any global phase", () => {
    for (const g of [0, 1, 2, 3]) {
      const r = floquetSpectrum(make(2, `p(0.7) q[0]; p(2) q[1]; gphase(${g});`).circ, {}, [])!;
      expect(r.meanR).toBeCloseTo(0.3669092229, 9);
    }
  });
});

describe("Fourier spectra read a unit cosine as 1 in every bin, Nyquist included", () => {
  test("⟨Z⟩ of rx(64t) over 128 samples (review counterexample), and rx(m·t) for other bins", () => {
    for (const m of [1, 5, 32, 64]) {
      const r = tSweepSpectrum(make(1, `rx(${m}*t) q[0];`, { t: 0 }).circ, { t: 0 }, [], 128)!;
      expect(r.mag[0][m]).toBeCloseTo(1, 10);
    }
  });

  test("autocorrelation: C(t) = cos(2mt) for rx(2m·t)… peaks read 1 at the Nyquist bin too", () => {
    // P = points − 1 = 8 samples per period; ⟨Z(t)Z⟩ for rx(4t) is cos 4t: bin 4 is Nyquist.
    const r = temporalAutocorrelation(make(1, "rx(4*t) q[0];", { t: 0 }).circ, { t: 0 }, [], 0, 9)!;
    expect(r.spectrum[4]).toBeCloseTo(1, 10);
  });
});

describe("effective temperature", () => {
  test("an eigenstate has no Boltzmann fit; the ground state's energy-matched T is 0, not ∞ (review counterexample)", () => {
    const r = effectiveTemperature(diagonalEnsemble([{ coefficient: 1, paulis: "Z" }], Float64Array.from([0, 0, 1, 0]), 1)!);
    expect(r.fitted).toBe(false);
    expect(r.beta).toBeNaN();
    expect(r.temperature).not.toBe(Infinity);
    expect(r.betaEnergy).toBe(Infinity);
    expect(r.temperatureEnergy).toBe(0);
  });

  test("Gibbs populations give the same β from the fit and from energy matching", () => {
    const E = [-1.3, -0.2, 0.4, 1.7], beta = 0.83;
    const w = E.map((e) => Math.exp(-beta * e)), Z = w.reduce((a, b) => a + b);
    const populations = w.map((x) => x / Z), meanEnergy = E.reduce((s, e, k) => s + e * populations[k], 0);
    const r = effectiveTemperature({ energies: E, populations, meanEnergy } as Parameters<typeof effectiveTemperature>[0]);
    expect(r.beta).toBeCloseTo(beta, 10);
    expect(r.r2).toBeCloseTo(1, 10);
    expect(r.betaEnergy).toBeCloseTo(beta, 9);
    expect(energyMatchedBeta(E, E[3])).toBe(-Infinity);
  });
});

describe("one orientation for Berry phase, Chern flux and QGT curvature", () => {
  const sphere = () => make(1, "ry(theta) q[0]; rz(phi) q[0];", { theta: 0, phi: 0 }).circ;

  test("plaquette flux / area has the sign and size of −2 Im Q (review counterexample)", () => {
    const grid = 40, h = (2 * Math.PI) / grid;
    const c = chernNumber(sphere(), {}, [], "theta", "phi", grid)!;
    const q = quantumGeometricTensor(sphere(), [], { theta: Math.PI / 2 + h / 2, phi: h / 2 }, ["theta", "phi"])!;
    expect(Math.sign(c.curvature[10][0])).toBe(Math.sign(q.berry[0][1]));
    expect(c.curvature[10][0] / (h * h)).toBeCloseTo(q.berry[0][1], 2);
  });

  test("the Berry phase around a loop is the flux through the plaquettes it encloses", () => {
    const grid = 40, h = (2 * Math.PI) / grid;
    const c = chernNumber(sphere(), {}, [], "theta", "phi", grid)!;
    // Square of side 2h centred on grid vertex (θ, φ) = (11h, 2h): plaquettes i ∈ {10, 11}, j ∈ {1, 2}.
    const b = berryPhase(sphere(), { theta: 11 * h, phi: 2 * h }, [], "theta", "phi", h, 16)!;
    const flux = c.curvature[10][1] + c.curvature[11][1] + c.curvature[10][2] + c.curvature[11][2];
    expect(Math.sign(b.gamma)).toBe(Math.sign(flux));
    expect(b.gamma).toBeCloseTo(flux, 3);
  });

  test("a family that isn't periodic on the torus is flagged (review: ry(θ/2) gives grid-dependent C)", async () => {
    const { ctx } = make(1, "ry(theta/2) q[0]; rz(phi) q[0];", { theta: 0, phi: 0 });
    const c = chernNumber(lowerTape(1, ctx.tape), {}, [], "theta", "phi", 12)!;
    expect(c.periodicOverlap).toBeLessThan(0.5);
    const r = await runAnalysis("chern", ctx, { s1: "theta", s2: "phi", grid: 12 });
    expect(String(r.scalars?.[0].value)).toMatch(/not an invariant/);
    expect(r.notes?.join(" ")).toMatch(/aren't periodic/);
  });
});

describe("prefix conditional entropy (formerly 'entanglement contour')", () => {
  test("Bell ⊗ |0⟩ with A = {q0, q1} gives the chain rule [+1, −1], and the UI says what it is", () => {
    const r = entanglementContour(make(3, "h q[0]; cx q[0],q[1];").ctx.state, 3, 2)!;
    expect(r.contour.map((x) => +x.toFixed(12))).toEqual([1, -1]);
    expect(r.total).toBeCloseTo(0, 12);
    expect(ANALYSIS_BY_ID.contour.title).toBe("Prefix conditional entropy");
  });
});

describe("OTOC growth rate", () => {
  test("the fit window is contiguous and rising; the result carries its R²", () => {
    const r = lyapunovExponent(make(2, "rxx(t) q[0],q[1];", { t: 0 }).circ, {}, [], 0, 1, 48)!;
    const idx = r.lnC.map((y, k) => (Number.isFinite(y) ? k : -1)).filter((k) => k >= 0);
    expect(idx.length).toBeGreaterThanOrEqual(3);
    expect(idx[idx.length - 1] - idx[0]).toBe(idx.length - 1);
    for (let i = 1; i < idx.length; i++) expect(r.C[idx[i]]).toBeGreaterThan(r.C[idx[i - 1]]);
    expect(r.r2).toBeGreaterThanOrEqual(0);
    expect(r.r2).toBeLessThanOrEqual(1);
  });
});

// Follow-up review: clustered spectra, energy offsets, absent correlations, energy scale.

describe("follow-up: Floquet on a clustered spectrum, through matrix synthesis", () => {
  test("phases 1e-10 apart survive MATRIX → circuit → Floquet: ⟨r⟩ matches the designed spectrum, residuals tiny", () => {
    const r = rng(20260924);
    const th = Array.from({ length: 8 }, () => (r() < 0.5 ? -0.9 : 0.8) + (2 * r() - 1) * 1e-10);
    const W = withSpectrum(randomUnitary(8, r), th);
    const def = matrixGate("CL", { k: 3, U: W });
    const res = floquetSpectrum(lowerTape(3, def.tape), {}, [])!;
    expect(res.residual).toBeLessThan(1e-12);
    expect(res.orthogonality).toBeLessThan(1e-12);
    const ps = sorted(th);
    const gaps = ps.map((v, i) => (i + 1 < ps.length ? ps[i + 1] - v : 2 * Math.PI + ps[0] - v));
    const want = gaps.reduce((s, g, i) => s + Math.min(g, gaps[(i + 1) % 8]) / Math.max(g, gaps[(i + 1) % 8]), 0) / 8;
    expect(res.meanR).toBeCloseTo(want, 3);
    expect(res.degenerateGaps).toBe(0);
  });
});

describe("follow-up: energy-matched β", () => {
  test("⟨H⟩ at the levels' average is β = 0 exactly (T = ∞), through the solver and the LAB screen", async () => {
    expect(Object.is(energyMatchedBeta([-1, 1], 0), 0)).toBe(true);
    const state = new Float64Array([Math.SQRT1_2, 0, Math.SQRT1_2, 0]);
    const ui = await runAnalysis("efftemp", { n: 1, state, tape: [], scope: {} }, { obs: "Z" });
    expect(ui.scalars?.find((x) => x.label === "T matching ⟨H⟩")?.value).toBe("∞");
  });

  test("an energy offset or a rescaling of H changes nothing but β's units", () => {
    const E = [-1.3, -0.2, 0.4, 1.7], mean = -0.35;
    const base = energyMatchedBeta(E, mean);
    expect(energyMatchedBeta(E.map((e) => e + 1e12), mean + 1e12)).toBeCloseTo(base, 3); // offset rounding ~1e-4 of the gaps
    expect(energyMatchedBeta(E.map((e) => e + 37), mean + 37)).toBeCloseTo(base, 10);
    expect(energyMatchedBeta([1e12 - 1, 1e12 + 1], 1e12)).toBe(0);
    expect(energyMatchedBeta(E.map((e) => 1e-9 * e), 1e-9 * mean) * 1e-9).toBeCloseTo(base, 8);
  });
});

describe("follow-up: correlation length", () => {
  test("a product state has no correlations, not an infinite correlation length", async () => {
    const reg = new Register(3);
    const res = correlationLength(reg.state, 3)!;
    expect(res.status).toBe("uncorrelated");
    expect(res.xi).toBeNaN();
    const ui = await runAnalysis("corrlength", { n: 3, state: reg.state, tape: [], scope: {} }, {});
    expect(String(ui.scalars?.[0].value)).toMatch(/no connected ZZ correlations/);
  });

  test("GHZ correlations don't decay: ξ = ∞ is kept for that case", () => {
    const res = correlationLength(make(4, "h q[0]; cx q[0],q[1]; cx q[1],q[2]; cx q[2],q[3];").ctx.state, 4)!;
    expect(res.status).toBe("flat");
    expect(res.xi).toBe(Infinity);
  });
});

describe("follow-up: Krylov complexity is independent of H's scale", () => {
  test.each([1e-10, 1e-3, 1, 1e6])("H = %s·(X + 0.4 Z) on |0⟩ …, and a 3-qubit chain", (scale) => {
    const one = (c: number) => [{ coefficient: c, paulis: "X" }, { coefficient: 0.4 * c, paulis: "Z" }];
    const base = krylovComplexity(one(1), new Float64Array([1, 0, 0, 0]), 1)!;
    const scaled = krylovComplexity(one(scale), new Float64Array([1, 0, 0, 0]), 1)!;
    expect(scaled.krylovDim).toBe(base.krylovDim);
    expect(scaled.complexity).toEqual(base.complexity.map((x) => expect.closeTo(x, 8)));
    const chain = (c: number) => [{ coefficient: c, paulis: "XXI" }, { coefficient: c, paulis: "IXX" }, { coefficient: 0.7 * c, paulis: "ZII" }];
    const psi = make(3, "h q[0]; ry(0.4) q[2];").ctx.state;
    expect(krylovComplexity(chain(scale), psi, 3)!.krylovDim).toBe(krylovComplexity(chain(1), psi, 3)!.krylovDim);
  });
});

// Invariance review: H′ = a·H + b·I rescales energy differences by a and moves the origin by b; nothing else changes.
describe("energy offset and unit invariance", () => {
  const term = (paulis: string, coefficient = 1) => ({ paulis, coefficient });
  const zero1 = new Float64Array([1, 0, 0, 0]), plus1 = new Float64Array([Math.SQRT1_2, 0, Math.SQRT1_2, 0]);
  const xGate = lowerTape(1, make(1, "x q[0];").ctx.tape);

  test("review cases: 1e-10·Z, Z + 1e10·I, 1e-15·X keep their levels; the X-quench work is −2e-10", () => {
    expect(diagonalEnsemble([term("Z", 1e-10)], plus1, 1)!.energies).toEqual([-1e-10, 1e-10]);
    expect(diagonalEnsemble([term("Z"), term("I", 1e10)], plus1, 1)!.energies).toEqual([1e10 - 1, 1e10 + 1]);
    expect(hamiltonianSpectrum([term("X", 1e-15)], 1)!.gap / 1e-15).toBeCloseTo(2, 10);
    expect(workDistribution([term("Z", 1e-10)], xGate, {}, [])!.meanWork / 1e-10).toBeCloseTo(-2, 8);
  });

  test("review cases: Boltzmann fit under 1e8 offset and 1e-7 units; spread under offset; LAB levels", async () => {
    const p0 = 1 / (1 + Math.exp(-2)), st = new Float64Array([Math.sqrt(1 - p0), 0, Math.sqrt(p0), 0]);
    for (const [a, b] of [[1, 0], [1, 1e8], [1e-7, 0]]) {
      const r = effectiveTemperature(diagonalEnsemble([term("Z", a), term("I", b)], st, 1)!);
      expect(r.beta * a).toBeCloseTo(1, 6);
    }
    expect(diagonalEnsemble([term("Z"), term("I", 1e8)], plus1, 1)!.energySpread).toBeCloseTo(1, 8);
    for (const obs of ["0.0000000001 Z", "Z + 100000000 I"]) {
      const ui = await runAnalysis("efftemp", { n: 1, state: st, tape: [], scope: {} }, { obs });
      expect(ui.error).toBeUndefined();
      expect(String(ui.scalars?.[0].value)).not.toMatch(/needs/);
    }
  });

  test("review cases: Krylov with an offset, tiny units, and H = 0", () => {
    const k = (a: number, b: number) => krylovComplexity([term("X", a), term("I", b)], zero1, 1)!;
    const base = k(1, 0);
    expect(k(1, 1e10).krylovDim).toBe(2);
    expect(k(1, 1e10).maxComplexity).toBeCloseTo(base.maxComplexity, 10);
    expect(k(1e-14, 0).maxComplexity).toBeCloseTo(base.maxComplexity, 10);
    const z = k(0, 0);
    expect(z.krylovDim).toBe(1);
    expect(z.complexity.every((x) => x === 0)).toBe(true);
  });

  test("review cases: level ratio, SFF plateau and DOS of [−3, −1, 0, 4] in any unit", () => {
    for (const a of [1e-10, 1e-14, 1e6]) {
      const E = [-3, -1, 0, 4].map((x) => x * a);
      expect(levelStatistics(E)!.meanRatio).toBeCloseTo(0.375, 12);
      expect(spectralFormFactor(E, 12)!.plateau).toBe(0.25);
      expect(densityOfStates(E)!.counts).toEqual(densityOfStates([-3, -1, 0, 4])!.counts);
    }
  });

  // A generic two-qubit H (non-degenerate) and a state with weight on every level.
  const H: PauliTerm[] = [term("XX", 0.7), term("ZI", 0.43), term("IZ", 0.19), term("YZ", 0.23)];
  const psi = new Float64Array([Math.sqrt(0.1), 0, Math.sqrt(0.2), 0, Math.sqrt(0.3), 0, Math.sqrt(0.4), 0]);
  const quench = lowerTape(2, make(2, "h q[0]; cx q[0],q[1]; ry(0.3) q[1];").ctx.tape);
  const all = (a: number, b: number) => {
    const h = [...H.map((t) => ({ ...t, coefficient: a * t.coefficient })), ...(b ? [term("II", b)] : [])];
    const spec = hamiltonianSpectrum(h, 2)!, de = diagonalEnsemble(h, psi, 2)!;
    return {
      spec, de, et: effectiveTemperature(de), ee: eigenstateEntanglement(h, 2)!, eth: ethOffDiagonal(h, [term("ZI")], 2)!,
      work: workDistribution(h, quench, {}, [])!, lvl: levelStatistics(spec.energies)!, sff: spectralFormFactor(spec.energies, 16)!,
      dos: densityOfStates(spec.energies)!, kr: krylovComplexity(h, psi, 2, { samples: 16 })!,
    };
  };
  const ref = all(1, 0);
  // Pairs (a, b) whose offset keeps the level spacing representable: ε·|b|/a ≤ 1e-7.
  const pairs = [1e-10, 1e-3, 1, 1e6].flatMap((a) => [0, 37, 1e8].map((b) => [a, b] as const)).filter(([a, b]) => (Number.EPSILON * b) / a <= 1e-7);
  test.each(pairs)("H′ = %s·H + %s·I", (a, b) => {
    const r = all(a, b);
    const tol = 1e-9 + (100 * Number.EPSILON * b) / a; // relative resolution of the shifted spectrum
    const close = (x: number, y: number) => expect(Math.abs(x - y)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(y)));
    r.spec.energies.forEach((e, k) => close((e - b) / a, ref.spec.energies[k]));
    close(r.spec.gap / a, ref.spec.gap);
    r.de.populations.forEach((p, k) => close(p, ref.de.populations[k]));
    close((r.de.meanEnergy - b) / a, ref.de.meanEnergy);
    close(r.de.energySpread / a, ref.de.energySpread);
    close(r.et.beta * a, ref.et.beta);
    close(r.et.betaEnergy * a, ref.et.betaEnergy);
    close(r.et.r2, ref.et.r2);
    r.ee.entropies.forEach((x, k) => close(x, ref.ee.entropies[k]));
    r.eth.offDiag.forEach((p, k) => { close(p.omega / a, ref.eth.offDiag[k].omega); close(p.mag2, ref.eth.offDiag[k].mag2); });
    close(r.work.meanWork / a, ref.work.meanWork);
    close(r.work.variance / (a * a), ref.work.variance);
    close(r.lvl.meanRatio, ref.lvl.meanRatio);
    expect(r.sff.plateau).toBe(ref.sff.plateau);
    expect(r.dos.counts).toEqual(ref.dos.counts);
    expect(r.kr.krylovDim).toBe(ref.kr.krylovDim);
    r.kr.complexity.forEach((x, k) => close(x, ref.kr.complexity[k]));
    r.kr.times.forEach((t, k) => close(t * a, ref.kr.times[k]));
  });
});
