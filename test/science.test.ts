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
