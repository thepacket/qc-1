/**
 * Effective temperature from the diagonal ensemble (ETH). After dephasing in
 * the energy eigenbasis, the state's energy populations are p_k = |⟨E_k|ψ⟩|².
 * If the system thermalises, those populations follow a Boltzmann law
 * p_k ∝ e^{−βE_k}, so a linear fit of ln p_k against E_k has slope −β and the
 * effective inverse temperature β (and T = 1/β) reads off the prepared
 * state's place on the thermal scale. A good linear fit (high R²) is direct
 * evidence of eigenstate thermalisation; scatter away from the line signals
 * athermal behaviour. Reuses the diagonal-ensemble populations.
 */

import type { DiagonalEnsembleResult } from "./diagonalEnsemble";

export type EffectiveTempResult = {
  energies: number[];
  /** ln p_k for populations above threshold (aligned with `energies`; NaN below). */
  logPop: number[];
  /** Inverse temperature β (slope = −β of the Boltzmann fit). */
  beta: number;
  /** Temperature 1/β. */
  temperature: number;
  /** Coefficient of determination R² of the linear fit. */
  r2: number;
  /** Fit line ln p = intercept − βE, for drawing. */
  intercept: number;
  /** QC-1: whether the fit exists (≥ 2 populated levels at different energies); β, T, R², intercept are NaN otherwise. */
  fitted: boolean;
  /** QC-1: the canonical β whose thermal state has the same ⟨H⟩ (±∞ at the spectrum's edges, NaN for H ∝ I). */
  betaEnergy: number;
  /** QC-1: 1/betaEnergy (0 at the ground state). */
  temperatureEnergy: number;
};

/**
 * QC-1: β of the Gibbs state e^{−βH}/Z with Tr(ρ_β H) equal to the state's
 * ⟨H⟩ (energy matching). ⟨H⟩_β falls monotonically with β, so bisection finds
 * it; a state at the lowest (highest) level has β = +∞ (−∞).
 */
export function energyMatchedBeta(energies: number[], meanEnergy: number): number {
  // Work in x = (E − mid)/w ∈ [−½, ½]: the answer can't depend on an energy
  // offset, and tolerances follow the spectrum's width, not its position.
  const lo = Math.min(...energies), hi = Math.max(...energies);
  const w = hi - lo, mid = lo + w / 2;
  if (!(w > 64 * Number.EPSILON * Math.max(Math.abs(lo), Math.abs(hi)))) return NaN; // H ∝ I: every β gives the same state
  const xs = energies.map((e) => (e - mid) / w);
  const m = (meanEnergy - mid) / w;
  const tol = 1e-12;
  if (m <= -0.5 + tol) return Infinity;
  if (m >= 0.5 - tol) return -Infinity;
  const mean = (b: number) => {
    const ex = xs.map((x) => -b * x), top = Math.max(...ex);
    let z = 0, xz = 0;
    xs.forEach((x, k) => { const q = Math.exp(ex[k] - top); z += q; xz += q * x; });
    return xz / z;
  };
  // β = 0 (infinite temperature) exactly when ⟨H⟩ is the plain average of the levels.
  if (Math.abs(mean(0) - m) <= tol) return 0;
  let a = -1, b = 1;
  while (mean(a) < m && a > -1e15) a *= 2;
  while (mean(b) > m && b < 1e15) b *= 2;
  for (let i = 0; i < 200 && b - a > 1e-15 * Math.max(1, Math.abs(a), Math.abs(b)); i++) {
    const c = (a + b) / 2;
    if (mean(c) > m) a = c; else b = c;
  }
  return (a + b) / 2 / w;
}

export function effectiveTemperature(diag: DiagonalEnsembleResult, threshold = 1e-9): EffectiveTempResult {
  const { energies, populations } = diag;
  const logPop = populations.map((p) => (p > threshold ? Math.log(p) : NaN));

  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 0; k < energies.length; k++) {
    if (Number.isFinite(logPop[k])) { xs.push(energies[k]); ys.push(logPop[k]); }
  }
  // QC-1 fix (docs/quantiom-bugs.md #28): with fewer than two populated
  // levels there is no line to fit; upstream reported β = 0, T = ∞ (an
  // eigenstate, even the ground state, read as infinitely hot). No fit: NaN.
  let beta = NaN;
  let intercept = NaN;
  let r2 = NaN;
  // QC-1 fix (docs/quantiom-bugs.md #37): regress on centred, width-scaled
  // energies u = (E − Ē)/w and map back (slope/w). Raw sums N·Σx² − (Σx)²
  // cancelled under an offset (Z + 10⁸·I: "no fit"), and the absolute 1e-12
  // denominator test refused small units (10⁻⁷·Z).
  const xMin = Math.min(...xs), xMax = Math.max(...xs), w = xMax - xMin;
  if (xs.length >= 2 && w > 64 * Number.EPSILON * Math.max(Math.abs(xMin), Math.abs(xMax))) {
    const N = xs.length;
    const xBar = xs.reduce((a, b) => a + b, 0) / N, yBar = ys.reduce((a, b) => a + b, 0) / N;
    const us = xs.map((x) => (x - xBar) / w);
    let suu = 0, suy = 0;
    for (let k = 0; k < N; k++) { suu += us[k] * us[k]; suy += us[k] * (ys[k] - yBar); }
    const slopeU = suy / suu;
    const slope = slopeU / w;
    beta = -slope;
    intercept = yBar - slope * xBar;
    // R².
    let ssTot = 0, ssRes = 0;
    for (let k = 0; k < N; k++) {
      ssTot += (ys[k] - yBar) ** 2;
      ssRes += (ys[k] - yBar - slopeU * us[k]) ** 2;
    }
    r2 = ssTot > 1e-12 ? Math.max(0, 1 - ssRes / ssTot) : 1;
  }
  const betaEnergy = energyMatchedBeta(energies, diag.meanEnergy);
  return {
    energies, logPop, beta, temperature: beta !== 0 ? 1 / beta : Infinity, r2, intercept,
    fitted: Number.isFinite(beta), betaEnergy, temperatureEnergy: 1 / betaEnergy,
  };
}
