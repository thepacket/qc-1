/**
 * Density of states of a Pauli-sum Hamiltonian — a histogram of its exact
 * energy spectrum. Where the Hamiltonian-spectrum panel draws individual
 * levels, the DOS coarse-grains them into bins so the *shape* of the spectrum
 * is legible: a Gaussian bulk (typical of generic many-body H), spectral
 * edges, gaps, and degeneracy spikes. The DOS shape underlies the spectral
 * form factor and level-statistics diagnostics.
 *
 * A thin wrapper over the eigenvalue list (from `hamiltonianSpectrum`): bins
 * the energies and reports counts. Pure.
 */

export type DosResult = {
  /** Bin centres (energy). */
  centers: number[];
  /** Count of eigenvalues in each bin. */
  counts: number[];
  /** Bin width. */
  binWidth: number;
  eMin: number;
  eMax: number;
  total: number;
};

export function densityOfStates(energies: number[], bins = 24): DosResult | null {
  if (energies.length === 0 || bins < 1) return null;
  let eMin = Infinity;
  let eMax = -Infinity;
  for (const e of energies) {
    if (e < eMin) eMin = e;
    if (e > eMax) eMax = e;
  }
  const span = eMax - eMin;
  // Degenerate spectrum (all equal): single populated bin.
  // QC-1 fix (docs/quantiom-bugs.md #36): flat means below the energies' own
  // resolution, not below an absolute 1e-12.
  const flat = !(span > 64 * Number.EPSILON * Math.max(Math.abs(eMin), Math.abs(eMax)));
  const binWidth = !flat ? span / bins : 1;
  const counts = new Array<number>(bins).fill(0);
  for (const e of energies) {
    let b = !flat ? Math.floor((e - eMin) / binWidth) : 0;
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  const centers = Array.from({ length: bins }, (_, b) => eMin + (b + 0.5) * binWidth);
  return { centers, counts, binWidth, eMin, eMax, total: energies.length };
}
