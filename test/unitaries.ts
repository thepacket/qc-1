/** Seeded random unitaries and unitaries of a chosen spectrum, for eigensolver tests. */
import type { Complex } from "../src/sim/density";

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A random unitary: Gram–Schmidt (twice) of complex Gaussian columns. */
export function randomUnitary(n: number, r: () => number): Complex[][] {
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-300)) * Math.cos(2 * Math.PI * r());
  const cols: Complex[][] = [];
  for (let k = 0; k < n; k++) {
    const v = Array.from({ length: n }, () => ({ re: gauss(), im: gauss() }));
    for (let pass = 0; pass < 2; pass++) for (const u of cols) {
      let pr = 0, pi = 0;
      for (let i = 0; i < n; i++) { pr += u[i].re * v[i].re + u[i].im * v[i].im; pi += u[i].re * v[i].im - u[i].im * v[i].re; }
      for (let i = 0; i < n; i++) { v[i].re -= pr * u[i].re - pi * u[i].im; v[i].im -= pr * u[i].im + pi * u[i].re; }
    }
    const nr = Math.sqrt(v.reduce((s, z) => s + z.re * z.re + z.im * z.im, 0));
    cols.push(v.map((z) => ({ re: z.re / nr, im: z.im / nr })));
  }
  return cols;
}
export function withSpectrum(Q: Complex[][], th: number[]): Complex[][] {
  const n = th.length; // W = Σ_k e^{iθ_k} q_k q_k†
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    let re = 0, im = 0;
    for (let k = 0; k < n; k++) {
      const a = Q[k][i], b = Q[k][j], c = Math.cos(th[k]), s = Math.sin(th[k]);
      const pr = a.re * b.re + a.im * b.im, pi = a.im * b.re - a.re * b.im; // q_i q̄_j
      re += c * pr - s * pi; im += c * pi + s * pr;
    }
    return { re, im };
  }));
}

