/**
 * Shared dense eigensolvers used by the analysis panels that need
 * eigenvectors (not just eigenvalues): a real-symmetric cyclic-Jacobi routine
 * and a complex-Hermitian solver built on the real-symmetric embedding
 * [[A, −B], [B, A]] (ρ = A + iB). Small dimensions only — these are O(d³) per
 * sweep, so callers cap n.
 */

import type { Complex } from "./density";

/** Real-symmetric eigensolver (cyclic Jacobi) with eigenvectors as columns. */
export function jacobiSym(Ain: number[][]): { values: number[]; vectors: number[][] } {
  const n = Ain.length;
  const A = Ain.map((r) => [...r]);
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) as number),
  );
  // QC-1 fix (docs/quantiom-bugs.md #34): stop relative to the matrix's own
  // size; an absolute 1e-26 left H = 1e-15·X undiagonalised (energies 0, 0).
  let fro = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) fro += A[i][j] * A[i][j];
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off <= 1e-28 * fro) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const app = A[p][p], aqq = A[q][q], apq = A[p][q];
        let c: number, s: number;
        if (Math.abs(aqq - app) < 1e-30) {
          c = Math.SQRT1_2; s = (apq >= 0 ? 1 : -1) * Math.SQRT1_2;
        } else {
          const theta = (aqq - app) / (2 * apq);
          const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(1 + theta * theta));
          c = 1 / Math.sqrt(1 + t * t); s = t * c;
        }
        for (let i = 0; i < n; i++) {
          const aip = A[i][p], aiq = A[i][q];
          A[i][p] = c * aip - s * aiq; A[i][q] = s * aip + c * aiq;
        }
        for (let j = 0; j < n; j++) {
          const apj = A[p][j], aqj = A[q][j];
          A[p][j] = c * apj - s * aqj; A[q][j] = s * apj + c * aqj;
        }
        for (let i = 0; i < n; i++) {
          const vip = V[i][p], viq = V[i][q];
          V[i][p] = c * vip - s * viq; V[i][q] = s * vip + c * viq;
        }
      }
    }
  }
  return { values: Array.from({ length: n }, (_, i) => A[i][i]), vectors: V };
}

/** Eigen-decomposition of a complex Hermitian matrix via the real-symmetric
 *  embedding; returns the d eigenvalues (ascending) + complex eigenvectors. */
/**
 * QC-1: H = c·I + s·M with c = tr H / d, tr M = 0 and max |M_ij| = 1 (s = 0
 * for H ∝ I). Solvers work on M, so an energy offset or a change of units
 * can't move the spectrum across an absolute tolerance.
 */
export function normalizeHermitian(H: Complex[][]): { M: Complex[][]; c: number; s: number } {
  const d = H.length;
  let c = 0;
  for (let i = 0; i < d; i++) c += H[i][i].re / d;
  let s = 0;
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) s = Math.max(s, Math.hypot(H[i][j].re - (i === j ? c : 0), H[i][j].im));
  const k = s > 0 ? 1 / s : 0;
  return { M: H.map((row, i) => row.map((z, j) => ({ re: (z.re - (i === j ? c : 0)) * k, im: z.im * k }))), c, s };
}

export function hermitianEig(Hin: Complex[][]): { values: number[]; vectors: Complex[][] } {
  // QC-1 fix (docs/quantiom-bugs.md #34): diagonalise the centred, scaled M
  // and map back E = c + s·λ. Clustering 1e-9·max(1, |E|) on raw energies
  // merged 1e-10·Z's levels and those of Z + 10¹⁰·I.
  const { M: H, c: shift, s: scale } = normalizeHermitian(Hin);
  const d = H.length;
  if (scale === 0) return { values: new Array<number>(d).fill(shift), vectors: H.map((_, i) => H.map((__, j) => ({ re: i === j ? 1 : 0, im: 0 }))) };
  const M: number[][] = Array.from({ length: 2 * d }, () => new Array<number>(2 * d).fill(0));
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      const a = H[i][j].re, b = H[i][j].im;
      M[i][j] = a; M[i][j + d] = -b;
      M[i + d][j] = b; M[i + d][j + d] = a;
    }
  }
  const { values, vectors } = jacobiSym(M);
  const order = Array.from({ length: 2 * d }, (_, i) => i).sort((p, q) => values[p] - values[q]);
  // QC-1 fix (docs/quantiom-bugs.md #13): each eigenvalue of H appears twice
  // in the embedding, as u+iw and i(u+iw). Taking every other sorted vector
  // is only right for a non-degenerate H; in a degenerate cluster it can
  // return the same complex vector twice and miss another. Instead, for
  // each cluster of 2g equal embedding eigenvalues, Gram–Schmidt the 2g
  // complex candidates u+iw down to g orthonormal eigenvectors.
  const span = Math.max(1, ...values.map(Math.abs));
  const tol = 1e-9 * span;
  const outVals: number[] = [];
  const outVecs: Complex[][] = [];
  for (let start = 0; start < 2 * d; ) {
    let end = start + 1;
    while (end < 2 * d && values[order[end]] - values[order[start]] < tol) end++;
    const want = Math.round((end - start) / 2);
    const lambda = order.slice(start, end).reduce((s, c) => s + values[c], 0) / (end - start);
    const kept: Complex[][] = [];
    for (let k = start; k < end && kept.length < want; k++) {
      const col = order[k];
      const v: Complex[] = Array.from({ length: d }, (_, i) => ({ re: vectors[i][col], im: vectors[i + d][col] }));
      for (const u of kept) {
        // v −= ⟨u|v⟩ u
        let pr = 0, pi = 0;
        for (let i = 0; i < d; i++) { pr += u[i].re * v[i].re + u[i].im * v[i].im; pi += u[i].re * v[i].im - u[i].im * v[i].re; }
        for (let i = 0; i < d; i++) { v[i].re -= pr * u[i].re - pi * u[i].im; v[i].im -= pr * u[i].im + pi * u[i].re; }
      }
      let norm = 0;
      for (let i = 0; i < d; i++) norm += v[i].re * v[i].re + v[i].im * v[i].im;
      if (norm < 1e-12) continue; // i·(a vector already kept)
      const inv = 1 / Math.sqrt(norm);
      for (let i = 0; i < d; i++) { v[i].re *= inv; v[i].im *= inv; }
      kept.push(v);
    }
    for (const v of kept) { outVals.push(shift + scale * lambda); outVecs.push(v); }
    start = end;
  }
  return { values: outVals, vectors: outVecs };
}

/** Eigenvalues of a real symmetric 3×3 matrix (analytic), ascending. */
export function eig3(M: number[][]): number[] {
  const p1 = M[0][1] ** 2 + M[0][2] ** 2 + M[1][2] ** 2;
  const tr = M[0][0] + M[1][1] + M[2][2];
  if (p1 < 1e-18) return [M[0][0], M[1][1], M[2][2]].sort((a, b) => a - b);
  const q = tr / 3;
  const p2 = (M[0][0] - q) ** 2 + (M[1][1] - q) ** 2 + (M[2][2] - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  const B = M.map((row, i) => row.map((v, j) => (v - (i === j ? q : 0)) / p));
  const detB =
    B[0][0] * (B[1][1] * B[2][2] - B[1][2] * B[2][1]) -
    B[0][1] * (B[1][0] * B[2][2] - B[1][2] * B[2][0]) +
    B[0][2] * (B[1][0] * B[2][1] - B[1][1] * B[2][0]);
  let r = detB / 2;
  r = Math.max(-1, Math.min(1, r));
  const phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi);
  const e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  const e2 = 3 * q - e1 - e3;
  return [e3, e2, e1].sort((a, b) => a - b);
}
