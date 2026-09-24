/**
 * Floquet quasi-energy spectrum — the eigenphases of the circuit unitary U
 * (the one-period Floquet operator), e^{iθ_k}, distributed on the unit circle.
 *
 * U is **normal** (unitary), so it commutes with its Hermitian parts
 * H_c = (U + U†)/2 and H_s = (U − U†)/2i and shares their eigenvectors.
 * QC-1: we diagonalise H_c, then H_s inside each H_c cluster (calc/normalEig),
 * and read each quasi-energy off as the Rayleigh-quotient phase
 * θ_k = arg⟨v_k|U|v_k⟩, reporting the largest eigenpair residual. The level-spacing
 * of {θ_k} is the Floquet analogue of energy-level statistics — Poisson
 * (integrable) vs circular-ensemble repulsion (chaotic). Builds the dense U,
 * capped at a small n, run on demand.
 */

import type { Complex } from "./density";
import { normalEig } from "../calc/normalEig";
import { simulate, type ParameterValues } from "./simulate";
import type { Circuit } from "./types";
type CustomGate = unknown; // QC-1: custom gates arrive in Phase 6

export type FloquetResult = {
  /** Quasi-energies θ_k ∈ (−π, π]. */
  quasiEnergies: number[];
  /** Normalised consecutive spacings s_i = Δθ_i / mean(Δθ) (sorted θ). */
  spacings: number[];
  /** Mean consecutive-gap ratio ⟨r⟩ (Poisson ≈ 0.386, COE ≈ 0.527). */
  meanR: number;
  /** QC-1: largest eigenpair residual ‖U v − e^{iθ} v‖. */
  residual: number;
  /** QC-1: largest deviation of the eigenvectors' Gram matrix from I. */
  orthogonality: number;
  /** QC-1: gaps below GAP_RESOLUTION, counted as exact degeneracies (0). */
  degenerateGaps: number;
};

/** QC-1: phase gaps below this are treated as degeneracies. */
export const GAP_RESOLUTION = 1e-12;

export function floquetSpectrum(
  circuit: Circuit,
  paramValues: ParameterValues,
  customGates: CustomGate[],
  maxQubits = 6,
): FloquetResult | null {
  const n = circuit.numQubits;
  if (n < 1 || n > maxQubits) return null;
  const dim = 1 << n;

  // Dense U (column j = U|j⟩).
  const Ure: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  const Uim: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  for (let j = 0; j < dim; j++) {
    const psi = simulate(circuit, paramValues, customGates, { startIndex: j }).state;
    for (let i = 0; i < dim; i++) { Ure[i][j] = psi[2 * i]; Uim[i][j] = psi[2 * i + 1]; }
  }

  // QC-1 fix (docs/quantiom-bugs.md #25): one Hermitian combination
  // M = H_c + α·H_s merges two distinct phases whenever cos θ₁ + α sin θ₁ =
  // cos θ₂ + α sin θ₂ (e.g. a global phase atan α), and the Rayleigh phase of
  // the mixed vector is then neither. Diagonalise U as a normal matrix
  // (cluster by cluster, see calc/normalEig.ts) and keep the residual.
  const U: Complex[][] = Ure.map((row, i) => row.map((re, j) => ({ re, im: Uim[i][j] })));
  const eig = normalEig(U);
  const residual = eig.residual, orthogonality = eig.orthogonality;
  const quasiEnergies: number[] = eig.values.map(({ re, im }) => {
    // QC-1 fix (docs/quantiom-bugs.md #15): quasi-energies live on a circle;
    // report them in (−π, π] (atan2 gives −π for a −0 imaginary part).
    const th = Math.atan2(im, re);
    return th <= -Math.PI + 1e-12 ? Math.PI : th;
  });

  const sorted = [...quasiEnergies].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
  // …and the spacing statistics are circular: include the gap that wraps
  // across ±π, otherwise the result depends on where the branch cut falls.
  if (sorted.length > 1) gaps.push(2 * Math.PI - (sorted[sorted.length - 1] - sorted[0]));
  // QC-1: a gap below GAP_RESOLUTION can't be told from an exact degeneracy
  // (U itself carries ~1e-15 rounding from the gates); count it as one (0) and say how many.
  let degenerateGaps = 0;
  for (let i = 0; i < gaps.length; i++) if (gaps[i] < GAP_RESOLUTION) { gaps[i] = 0; degenerateGaps++; }
  const meanGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 1;
  const spacings = gaps.map((g) => g / (meanGap || 1));
  const ratios: number[] = [];
  // QC-1 fix (docs/quantiom-bugs.md #26): on the circle the last gap is
  // followed by the first; without that pair ⟨r⟩ depends on the global phase.
  for (let i = 0; i < (gaps.length > 1 ? gaps.length : 0); i++) {
    const a = gaps[i], b = gaps[(i + 1) % gaps.length];
    const mx = Math.max(a, b);
    if (mx > 1e-15) ratios.push(Math.min(a, b) / mx);
  }
  const meanR = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  return { quasiEnergies, spacings, meanR, residual, orthogonality, degenerateGaps };
}
