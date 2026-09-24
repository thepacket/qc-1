/**
 * Eigen-decomposition of a normal matrix (here: a unitary) with the Hermitian
 * solver only. A normal W commutes with its Hermitian parts
 * R = (W + W†)/2 and I = (W − W†)/2i, so every eigenspace of R is W-invariant.
 * Diagonalise R; inside each cluster of equal Re λ diagonalise I compressed
 * to that cluster (it splits ±Im λ pairs); a cluster still left with more
 * than one vector holds eigenvalues closer than the tolerance, so recurse on
 * the compressed W there, centred and rescaled, until the block is a multiple
 * of the identity. Unlike a single combination R + αI, this can't merge two
 * distinct eigenvalues whose combinations happen to coincide.
 *
 * Returns eigenvalues λ_k = ⟨v_k|W|v_k⟩ and orthonormal eigenvectors, plus the
 * largest residual ‖W v − λ v‖ so callers can check the decomposition.
 */
import type { Complex } from "../sim/density";
import { hermitianEig } from "../sim/eig";

type Vec = Complex[];
const TOL = 1e-7; // cluster width, relative to the block's scale
const FLAT = 1e-12; // a block this close to c·I is degenerate

function matVec(W: Complex[][], v: Vec): Vec {
  return W.map((row) => {
    let re = 0, im = 0;
    for (let j = 0; j < v.length; j++) { re += row[j].re * v[j].re - row[j].im * v[j].im; im += row[j].re * v[j].im + row[j].im * v[j].re; }
    return { re, im };
  });
}
/** ⟨a|b⟩ */
function dot(a: Vec, b: Vec): Complex {
  let re = 0, im = 0;
  for (let i = 0; i < a.length; i++) { re += a[i].re * b[i].re + a[i].im * b[i].im; im += a[i].re * b[i].im - a[i].im * b[i].re; }
  return { re, im };
}
/** V† W V for the orthonormal columns V (as a list of vectors). */
function compress(W: Complex[][], V: Vec[]): Complex[][] {
  const WV = V.map((v) => matVec(W, v));
  return V.map((a) => WV.map((wb) => dot(a, wb)));
}
/** The vectors Σ_j coeffs[j]·V[j] for each coefficient vector. */
function lift(V: Vec[], coeffs: Vec[]): Vec[] {
  const d = V[0].length;
  return coeffs.map((c) => {
    const out: Vec = Array.from({ length: d }, () => ({ re: 0, im: 0 }));
    c.forEach((x, j) => { for (let i = 0; i < d; i++) { out[i].re += x.re * V[j][i].re - x.im * V[j][i].im; out[i].im += x.re * V[j][i].im + x.im * V[j][i].re; } });
    return out;
  });
}
/** Groups of consecutive (ascending) values closer than tol. */
function clusters(values: number[], tol: number): number[][] {
  const out: number[][] = [];
  values.forEach((x, k) => {
    const last = out[out.length - 1];
    if (last && x - values[last[last.length - 1]] < tol) last.push(k);
    else out.push([k]);
  });
  return out;
}

/** Orthonormal eigenvectors of W inside span(V), which must be W-invariant. */
function split(W: Complex[][], V: Vec[], depth: number): Vec[] {
  if (V.length === 1) return V;
  const k = V.length;
  const A = compress(W, V);
  let c = { re: 0, im: 0 };
  for (let i = 0; i < k; i++) { c.re += A[i][i].re / k; c.im += A[i][i].im / k; }
  let scale = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const re = A[i][j].re - (i === j ? c.re : 0), im = A[i][j].im - (i === j ? c.im : 0);
    scale = Math.max(scale, Math.hypot(re, im));
  }
  if (scale < FLAT || depth > 6) return V; // c·I on this block: any basis is an eigenbasis
  // Hermitian parts of B = (A − cI)/scale.
  const B = A.map((row, i) => row.map((z, j) => ({ re: (z.re - (i === j ? c.re : 0)) / scale, im: (z.im - (i === j ? c.im : 0)) / scale })));
  const R = B.map((row, i) => row.map((_, j) => ({ re: (B[i][j].re + B[j][i].re) / 2, im: (B[i][j].im - B[j][i].im) / 2 })));
  const I = B.map((row, i) => row.map((_, j) => ({ re: (B[i][j].im + B[j][i].im) / 2, im: -(B[i][j].re - B[j][i].re) / 2 })));
  const out: Vec[] = [];
  const r = hermitianEig(R);
  for (const g of clusters(r.values, TOL)) {
    const G = g.map((i) => r.vectors[i]); // coefficients in V
    if (G.length === 1) { out.push(...lift(V, G)); continue; }
    const s = hermitianEig(compress(I, G));
    for (const h of clusters(s.values, TOL)) {
      const H = lift(V, lift(G, h.map((i) => s.vectors[i])));
      out.push(...(H.length === 1 ? H : split(W, H, depth + 1)));
    }
  }
  return out;
}

export function normalEig(W: Complex[][]): { values: Complex[]; vectors: Vec[]; residual: number } {
  const d = W.length;
  const basis: Vec[] = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => ({ re: i === j ? 1 : 0, im: 0 })));
  const vectors = split(W, basis, 0);
  let residual = 0;
  const values = vectors.map((v) => {
    const Wv = matVec(W, v);
    const lam = dot(v, Wv);
    let r2 = 0;
    for (let i = 0; i < d; i++) {
      const re = Wv[i].re - (lam.re * v[i].re - lam.im * v[i].im), im = Wv[i].im - (lam.re * v[i].im + lam.im * v[i].re);
      r2 += re * re + im * im;
    }
    residual = Math.max(residual, Math.sqrt(r2));
    return lam;
  });
  return { values, vectors, residual };
}
