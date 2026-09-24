/**
 * Two-point-measurement (TPM) work distribution for a quench.
 *
 * Protocol: start in |0…0⟩, project onto the eigenbasis of a Hamiltonian H
 * (first energy measurement → outcome E_n with probability p_n = |⟨E_n|0⟩|²),
 * apply the circuit as the quench unitary U, then measure H again. The work
 * done is W = E_m − E_n with probability
 *
 *   P(W) = Σ_{m,n} p_n · |⟨E_m|U|E_n⟩|² · δ(W − (E_m − E_n)),
 *
 * the central object of quantum fluctuation theorems (Jarzynski / Crooks).
 * The histogram's mean is the average work; its spread is the irreversibility
 * of the quench. Requires diagonalising H (with eigenvectors) and the dense
 * circuit unitary, so it runs on demand at a small qubit cap.
 */

import type { Complex } from "./density";
import { pauliSparse } from "./pauliMatrix";
import { hermitianEig } from "./eig";
import { simulate, type ParameterValues } from "./simulate";
import type { Circuit } from "./types";
type CustomGate = unknown; // QC-1: custom gates arrive in Phase 6
import type { PauliTerm } from "./trotter";

export type WorkDistResult = {
  /** Histogram bin centres (work values). */
  works: number[];
  /** Probability in each bin (sums to 1). */
  probs: number[];
  meanWork: number;
  /** Variance of the work. */
  variance: number;
  binWidth: number;
};

// QC-1 fix (docs/quantiom-bugs.md #13): the private embedding solvers that
// were here duplicated eigenvectors in degenerate levels; the shared
// hermitianEig (sim/eig.ts) is fixed.
export function workDistribution(
  terms: PauliTerm[],
  circuit: Circuit,
  paramValues: ParameterValues,
  customGates: CustomGate[],
  bins = 24,
  maxQubits = 5,
): WorkDistResult | null {
  const n = circuit.numQubits;
  if (n < 1 || n > maxQubits || terms.length === 0) return null;
  const dim = 1 << n;

  // Dense Hermitian H = Σ h_k P_k.
  const H: Complex[][] = Array.from({ length: dim }, () =>
    Array.from({ length: dim }, () => ({ re: 0, im: 0 })),
  );
  for (const term of terms) {
    if (term.coefficient === 0) continue;
    const { perm, phRe, phIm } = pauliSparse(n, term.paulis);
    const h = term.coefficient;
    for (let c = 0; c < dim; c++) {
      H[perm[c]][c].re += h * phRe[c];
      H[perm[c]][c].im += h * phIm[c];
    }
  }
  const { values: E, vectors: vecs } = hermitianEig(H);

  // Dense circuit unitary U (columns).
  const Ure: Float64Array[] = [];
  const Uim: Float64Array[] = [];
  for (let j = 0; j < dim; j++) {
    const psi = simulate(circuit, paramValues, customGates, { startIndex: j }).state;
    const cr = new Float64Array(dim), ci = new Float64Array(dim);
    for (let i = 0; i < dim; i++) { cr[i] = psi[2 * i]; ci[i] = psi[2 * i + 1]; }
    Ure.push(cr); Uim.push(ci);
  }

  // QC-1 fix (docs/quantiom-bugs.md #14): a two-point measurement of H
  // projects onto energy *levels*. With degenerate levels the probability of
  // (E_n → E_m) is ‖Π_m U Π_n |0⟩‖², not Σ over single eigenvectors
  // |⟨k|0⟩|²|⟨l|U|k⟩|² (that drops the cross terms inside a level).
  const levels: number[][] = [];
  // QC-1 fix (docs/quantiom-bugs.md #34): levels within 1e-9 of the spectrum's width, not of max(1, |E|).
  const eWidth = Math.max(...E) - Math.min(...E);
  E.forEach((e, k) => {
    const last = levels[levels.length - 1];
    if (last && Math.abs(E[last[0]] - e) <= 1e-9 * eWidth) last.push(k);
    else levels.push([k]);
  });
  const pairs: Array<{ w: number; prob: number }> = [];
  for (const ln of levels) {
    // φ = Π_n |0⟩ = Σ_{k∈n} ⟨k|0⟩ |k⟩, with ⟨k|0⟩ = conj(k[0]).
    const phRe = new Float64Array(dim), phIm = new Float64Array(dim);
    for (const k of ln) {
      const cr = vecs[k][0].re, ci = -vecs[k][0].im;
      for (let a = 0; a < dim; a++) {
        phRe[a] += cr * vecs[k][a].re - ci * vecs[k][a].im;
        phIm[a] += cr * vecs[k][a].im + ci * vecs[k][a].re;
      }
    }
    // V = U φ.
    const vRe = new Float64Array(dim), vIm = new Float64Array(dim);
    for (let a = 0; a < dim; a++) {
      let re = 0, im = 0;
      for (let b = 0; b < dim; b++) {
        const ur = Ure[b][a], ui = Uim[b][a]; // U_{ab} stored column b, row a
        re += ur * phRe[b] - ui * phIm[b];
        im += ur * phIm[b] + ui * phRe[b];
      }
      vRe[a] = re; vIm[a] = im;
    }
    for (const lm of levels) {
      // ‖Π_m V‖² = Σ_{l∈m} |⟨l|V⟩|².
      let t = 0;
      for (const l of lm) {
        let re = 0, im = 0;
        for (let a = 0; a < dim; a++) {
          re += vecs[l][a].re * vRe[a] + vecs[l][a].im * vIm[a];
          im += vecs[l][a].re * vIm[a] - vecs[l][a].im * vRe[a];
        }
        t += re * re + im * im;
      }
      if (t < 1e-15) continue;
      pairs.push({ w: E[lm[0]] - E[ln[0]], prob: t });
    }
  }
  let wMin = Infinity, wMax = -Infinity;
  for (const pr of pairs) { if (pr.w < wMin) wMin = pr.w; if (pr.w > wMax) wMax = pr.w; }
  if (!Number.isFinite(wMin)) { wMin = 0; wMax = 0; }
  const span = wMax - wMin;
  // QC-1: no absolute floor (1e-12 merged every work value of a small-unit H).
  const flat = !(span > 64 * Number.EPSILON * Math.max(Math.abs(wMin), Math.abs(wMax)));
  const binWidth = !flat ? span / bins : 1;
  const probs = new Array<number>(bins).fill(0);
  for (const pr of pairs) {
    let b = !flat ? Math.floor((pr.w - wMin) / binWidth) : 0;
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    probs[b] += pr.prob;
  }
  const totalP = probs.reduce((a, b) => a + b, 0) || 1;
  for (let b = 0; b < bins; b++) probs[b] /= totalP;
  const works = Array.from({ length: bins }, (_, b) => wMin + (b + 0.5) * binWidth);
  // Exact moments from the raw (work, prob) pairs — independent of binning, so
  // a single delta peak reports its true value rather than a bin centre.
  let mean = 0;
  for (const pr of pairs) mean += pr.w * (pr.prob / totalP);
  let variance = 0;
  for (const pr of pairs) variance += (pr.w - mean) * (pr.w - mean) * (pr.prob / totalP);
  return { works, probs, meanWork: mean, variance, binWidth };
}
