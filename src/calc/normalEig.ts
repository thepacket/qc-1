/**
 * Eigen-decomposition of a normal matrix (here: a unitary) by the complex
 * Schur decomposition W = Z T Z†: Householder reduction to Hessenberg form,
 * then shifted QR (Wilkinson shifts, Givens rotations, deflation). Z is a
 * product of unitary transformations, so its columns are orthonormal by
 * construction; for a normal W the triangular T is diagonal up to rounding,
 * so they are eigenvectors and diag T the eigenvalues, with backward error
 * ~ machine ε·‖W‖ however closely the eigenvalues cluster (eigenvalues of a
 * normal matrix are perfectly conditioned).
 *
 * Returns eigenvalues λ_k = ⟨z_k|W|z_k⟩, orthonormal eigenvectors, the largest
 * residual ‖W z − λ z‖ and the largest deviation of Z†Z from I, so callers
 * can gate their results on both.
 */
import type { Complex } from "../sim/density";

type Vec = Complex[];
const EPS = 2.220446049250313e-16;

export function normalEig(W: Complex[][]): { values: Complex[]; vectors: Vec[]; residual: number; orthogonality: number } {
  const n = W.length;
  // Row-major working copies: H (becomes T) and Z (Schur vectors, columns).
  const hr = new Float64Array(n * n), hi = new Float64Array(n * n);
  const zr = new Float64Array(n * n), zi = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    zr[i * n + i] = 1;
    for (let j = 0; j < n; j++) { hr[i * n + j] = W[i][j].re; hi[i * n + j] = W[i][j].im; }
  }

  // 1. Hessenberg: for each column k, a Householder reflector P = I − 2vv† zeroes H[k+2.., k]; H ← P H P, Z ← Z P.
  const vr = new Float64Array(n), vi = new Float64Array(n);
  for (let k = 0; k < n - 2; k++) {
    let norm = 0;
    for (let i = k + 1; i < n; i++) norm += hr[i * n + k] ** 2 + hi[i * n + k] ** 2;
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    const x0r = hr[(k + 1) * n + k], x0i = hi[(k + 1) * n + k], x0 = Math.hypot(x0r, x0i);
    // α = −e^{i arg x0}·‖x‖, v = x − α e1, normalised.
    const pr = x0 ? x0r / x0 : 1, pi = x0 ? x0i / x0 : 0;
    for (let i = 0; i < n; i++) { vr[i] = 0; vi[i] = 0; }
    for (let i = k + 1; i < n; i++) { vr[i] = hr[i * n + k]; vi[i] = hi[i * n + k]; }
    vr[k + 1] += pr * norm; vi[k + 1] += pi * norm;
    let vn = 0;
    for (let i = k + 1; i < n; i++) vn += vr[i] ** 2 + vi[i] ** 2;
    vn = Math.sqrt(vn);
    if (vn === 0) continue;
    for (let i = k + 1; i < n; i++) { vr[i] /= vn; vi[i] /= vn; }
    // Left: H ← H − 2 v (v† H), over rows k+1.. and all columns.
    for (let c = 0; c < n; c++) {
      let sr = 0, si = 0;
      for (let i = k + 1; i < n; i++) { const a = hr[i * n + c], b = hi[i * n + c]; sr += vr[i] * a + vi[i] * b; si += vr[i] * b - vi[i] * a; }
      for (let i = k + 1; i < n; i++) { hr[i * n + c] -= 2 * (vr[i] * sr - vi[i] * si); hi[i * n + c] -= 2 * (vr[i] * si + vi[i] * sr); }
    }
    // Right: M ← M − 2 (M v) v†, for H and Z.
    for (const [mr, mi] of [[hr, hi], [zr, zi]] as const) {
      for (let r = 0; r < n; r++) {
        let sr = 0, si = 0;
        for (let j = k + 1; j < n; j++) { const a = mr[r * n + j], b = mi[r * n + j]; sr += a * vr[j] - b * vi[j]; si += a * vi[j] + b * vr[j]; }
        for (let j = k + 1; j < n; j++) { mr[r * n + j] -= 2 * (sr * vr[j] + si * vi[j]); mi[r * n + j] -= 2 * (si * vr[j] - sr * vi[j]); }
      }
    }
    for (let i = k + 2; i < n; i++) { hr[i * n + k] = 0; hi[i * n + k] = 0; }
  }

  // 2. Shifted QR on the active window [lo, hi] of the Hessenberg matrix.
  // Rotations act on the window only (for a normal matrix the rest of T is zero), and on Z.
  const cs = new Float64Array(n), snr = new Float64Array(n), sni = new Float64Array(n);
  let top = n - 1, iter = 0, total = 0;
  while (top > 0) {
    // Deflate: find the lowest l with a negligible subdiagonal H[l][l−1].
    let l = top;
    for (; l > 0; l--) {
      const sub = Math.hypot(hr[l * n + l - 1], hi[l * n + l - 1]);
      const scale = Math.hypot(hr[l * n + l], hi[l * n + l]) + Math.hypot(hr[(l - 1) * n + l - 1], hi[(l - 1) * n + l - 1]);
      if (sub <= EPS * (scale || 1)) { hr[l * n + l - 1] = 0; hi[l * n + l - 1] = 0; break; }
    }
    if (l === top) { top--; iter = 0; continue; }
    if (++total > 100 * n) break; // never seen; the residual check reports it
    iter++;
    // Wilkinson shift: the eigenvalue of the trailing 2×2 closer to its corner (an exceptional shift every 10 stuck sweeps).
    const a = { re: hr[(top - 1) * n + top - 1], im: hi[(top - 1) * n + top - 1] }, b = { re: hr[(top - 1) * n + top], im: hi[(top - 1) * n + top] };
    const c = { re: hr[top * n + top - 1], im: hi[top * n + top - 1] }, d = { re: hr[top * n + top], im: hi[top * n + top] };
    let mu: Complex;
    if (iter % 10 === 0) mu = { re: d.re + Math.hypot(c.re, c.im), im: d.im };
    else {
      const hr2 = (a.re - d.re) / 2, hi2 = (a.im - d.im) / 2;
      const disc = { re: hr2 * hr2 - hi2 * hi2 + (b.re * c.re - b.im * c.im), im: 2 * hr2 * hi2 + (b.re * c.im + b.im * c.re) };
      const m = Math.hypot(disc.re, disc.im);
      const sq = { re: Math.sqrt((m + disc.re) / 2), im: Math.sign(disc.im || 1) * Math.sqrt(Math.max(0, (m - disc.re) / 2)) };
      const mid = { re: (a.re + d.re) / 2, im: (a.im + d.im) / 2 };
      const m1 = { re: mid.re + sq.re, im: mid.im + sq.im }, m2 = { re: mid.re - sq.re, im: mid.im - sq.im };
      mu = Math.hypot(m1.re - d.re, m1.im - d.im) <= Math.hypot(m2.re - d.re, m2.im - d.im) ? m1 : m2;
    }
    for (let k = l; k <= top; k++) { hr[k * n + k] -= mu.re; hi[k * n + k] -= mu.im; }
    // H − μI = QR: Givens G_k zeroes H[k+1][k]; G = [[c, s], [−s̄, c]] with real c.
    for (let k = l; k < top; k++) {
      const xr = hr[k * n + k], xi = hi[k * n + k], yr = hr[(k + 1) * n + k], yi = hi[(k + 1) * n + k];
      const ax = Math.hypot(xr, xi), rr = Math.hypot(ax, Math.hypot(yr, yi));
      let c0: number, sr0: number, si0: number;
      if (rr === 0) { c0 = 1; sr0 = 0; si0 = 0; }
      else if (ax === 0) { c0 = 0; sr0 = 1; si0 = 0; }
      else { c0 = ax / rr; const ur = xr / ax, ui = xi / ax; sr0 = (ur * yr + ui * yi) / rr; si0 = (ui * yr - ur * yi) / rr; } // s = (x/|x|)·ȳ/r
      cs[k] = c0; snr[k] = sr0; sni[k] = si0;
      for (let j = k; j <= top; j++) {
        const pr = hr[k * n + j], pi = hi[k * n + j], qr = hr[(k + 1) * n + j], qi = hi[(k + 1) * n + j];
        hr[k * n + j] = c0 * pr + (sr0 * qr - si0 * qi); hi[k * n + j] = c0 * pi + (sr0 * qi + si0 * qr);
        hr[(k + 1) * n + j] = -(sr0 * pr + si0 * pi) + c0 * qr; hi[(k + 1) * n + j] = -(sr0 * pi - si0 * pr) + c0 * qi;
      }
    }
    // RQ + μI: apply each G_k† on the right (columns k, k+1) of the window, and to Z.
    for (let k = l; k < top; k++) {
      const c0 = cs[k], sr0 = snr[k], si0 = sni[k];
      const rot = (mr: Float64Array, mi: Float64Array, r0: number, r1: number) => {
        for (let r = r0; r <= r1; r++) {
          const xr = mr[r * n + k], xi = mi[r * n + k], yr = mr[r * n + k + 1], yi = mi[r * n + k + 1];
          // x' = c x + s̄ y, y' = −s x + c y
          mr[r * n + k] = c0 * xr + (sr0 * yr + si0 * yi); mi[r * n + k] = c0 * xi + (sr0 * yi - si0 * yr);
          mr[r * n + k + 1] = -(sr0 * xr - si0 * xi) + c0 * yr; mi[r * n + k + 1] = -(sr0 * xi + si0 * xr) + c0 * yi;
        }
      };
      rot(hr, hi, l, Math.min(top, k + 2));
      rot(zr, zi, 0, n - 1);
    }
    for (let k = l; k <= top; k++) { hr[k * n + k] += mu.re; hi[k * n + k] += mu.im; }
  }

  // 3. Eigenpairs from the columns of Z, with independent checks.
  const vectors: Vec[] = Array.from({ length: n }, (_, k) => Array.from({ length: n }, (_, i) => ({ re: zr[i * n + k], im: zi[i * n + k] })));
  let residual = 0, orthogonality = 0;
  const values = vectors.map((v) => {
    const Wv = W.map((row) => {
      let re = 0, im = 0;
      for (let j = 0; j < n; j++) { re += row[j].re * v[j].re - row[j].im * v[j].im; im += row[j].re * v[j].im + row[j].im * v[j].re; }
      return { re, im };
    });
    let lr = 0, li = 0;
    for (let i = 0; i < n; i++) { lr += v[i].re * Wv[i].re + v[i].im * Wv[i].im; li += v[i].re * Wv[i].im - v[i].im * Wv[i].re; }
    let r2 = 0;
    for (let i = 0; i < n; i++) r2 += (Wv[i].re - (lr * v[i].re - li * v[i].im)) ** 2 + (Wv[i].im - (lr * v[i].im + li * v[i].re)) ** 2;
    residual = Math.max(residual, Math.sqrt(r2));
    return { re: lr, im: li };
  });
  for (let p = 0; p < n; p++) for (let q = p; q < n; q++) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) { re += vectors[p][i].re * vectors[q][i].re + vectors[p][i].im * vectors[q][i].im; im += vectors[p][i].re * vectors[q][i].im - vectors[p][i].im * vectors[q][i].re; }
    orthogonality = Math.max(orthogonality, Math.hypot(re - (p === q ? 1 : 0), im));
  }
  return { values, vectors, residual, orthogonality };
}
