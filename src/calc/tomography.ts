/**
 * Pauli-basis state tomography, as a hardware user runs it (Qiskit
 * Experiments' StateTomography): every qubit is measured in X, Y or Z, for all
 * 3ⁿ settings, N shots each; linear inversion gives ρ̂ = Σ_P ⟨P⟩ P / 2ⁿ, and
 * Smolin–Gambetta–Smith projects it onto the nearest physical density matrix.
 *
 * Each setting's shots are drawn from its exact outcome distribution (the
 * state or ρ rotated into that basis), which is statistically what running the
 * rotated circuit on a device gives, plus the model's readout flips.
 *
 * Qiskit's bit order: qubit q is bit q of an index; setting[q] is qubit q's
 * basis (0 = X, 1 = Y, 2 = Z).
 */
import { hermitianEig } from "../sim/eig";
import type { Complex } from "../sim/density";

/** Largest register reconstructed (3⁶ = 729 settings, a 64 × 64 ρ). */
export const TOMO_MAX = 6;

export type Basis = 0 | 1 | 2;

/** All 3ⁿ settings, setting s's qubit q basis = digit q of s in base 3. */
export function settings(n: number): Basis[][] {
  return Array.from({ length: 3 ** n }, (_, s) => Array.from({ length: n }, (_, q) => (Math.floor(s / 3 ** q) % 3) as Basis));
}

const R = Math.SQRT1_2;
/** The rotation into a basis, applied to (a, b) = amplitudes of |0⟩, |1⟩: X → H, Y → H·S†, Z → nothing. */
function rot(basis: Basis, ar: number, ai: number, br: number, bi: number): [number, number, number, number] {
  if (basis === 2) return [ar, ai, br, bi];
  if (basis === 1) { const t = br; br = bi; bi = -t; } // S†: b → −i·b
  return [R * (ar + br), R * (ai + bi), R * (ar - br), R * (ai - bi)];
}

/** Outcome probabilities of a pure state measured in a setting. */
export function stateProbs(state: Float64Array, n: number, setting: Basis[]): Float64Array {
  const st = Float64Array.from(state);
  for (let q = 0; q < n; q++) {
    if (setting[q] === 2) continue;
    const m = 1 << q;
    for (let i = 0; i < 1 << n; i++) {
      if (i & m) continue;
      const j = i | m;
      [st[2 * i], st[2 * i + 1], st[2 * j], st[2 * j + 1]] = rot(setting[q], st[2 * i], st[2 * i + 1], st[2 * j], st[2 * j + 1]);
    }
  }
  const p = new Float64Array(1 << n);
  for (let i = 0; i < p.length; i++) p[i] = st[2 * i] ** 2 + st[2 * i + 1] ** 2;
  return p;
}

/** Outcome probabilities of ρ (d × d, re/im interleaved, row-major) measured in a setting: diag(U ρ U†). */
export function rhoProbs(rho: Float64Array, n: number, setting: Basis[]): Float64Array {
  const d = 1 << n;
  const r = Float64Array.from(rho);
  for (let q = 0; q < n; q++) {
    if (setting[q] === 2) continue;
    const m = 1 << q;
    // U on the row index (columns as vectors), then U* on the column index.
    for (let c = 0; c < d; c++) for (let i = 0; i < d; i++) {
      if (i & m) continue;
      const j = i | m, a = 2 * (i * d + c), b = 2 * (j * d + c);
      [r[a], r[a + 1], r[b], r[b + 1]] = rot(setting[q], r[a], r[a + 1], r[b], r[b + 1]);
    }
    for (let row = 0; row < d; row++) for (let i = 0; i < d; i++) {
      if (i & m) continue;
      const j = i | m, a = 2 * (row * d + i), b = 2 * (row * d + j);
      // (U ρ U†)_{row, ·}: conj(U) acting on the column pair, i.e. rot of the conjugates, conjugated back.
      const [xr, xi, yr, yi] = rot(setting[q], r[a], -r[a + 1], r[b], -r[b + 1]);
      r[a] = xr; r[a + 1] = -xi; r[b] = yr; r[b + 1] = -yi;
    }
  }
  const p = new Float64Array(d);
  for (let i = 0; i < d; i++) p[i] = Math.max(0, r[2 * (i * d + i)]);
  return p;
}

/** N outcomes drawn from `probs`, then each bit flipped with its readout error rate. */
export function drawCounts(probs: Float64Array, shots: number, rng: () => number, readout: number[] = []): Map<number, number> {
  const cdf = new Float64Array(probs.length);
  let acc = 0;
  for (let i = 0; i < probs.length; i++) cdf[i] = acc += probs[i];
  const out = new Map<number, number>();
  for (let s = 0; s < shots; s++) {
    const u = rng() * acc;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] <= u) lo = mid + 1; else hi = mid; }
    let x = lo;
    for (let q = 0; q < readout.length; q++) if (readout[q] > 0 && rng() < readout[q]) x ^= 1 << q;
    out.set(x, (out.get(x) ?? 0) + 1);
  }
  return out;
}

const popcount = (x: number) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

/**
 * Linear inversion: ⟨P⟩ for every Pauli string P from the settings that
 * measure it (each qubit of P's support in P's basis; the rest free), averaged
 * over those settings; then ρ̂ = Σ_P ⟨P⟩ P / 2ⁿ. Returns ρ̂ (Hermitian, trace 1,
 * possibly with negative eigenvalues).
 */
export function linearInversion(n: number, counts: Map<number, number>[], shots: number): Float64Array {
  const d = 1 << n, S = settings(n);
  // ⟨P⟩ sums and counts, P coded base 4 (digit q: 0 = I, 1 = X, 2 = Y, 3 = Z).
  const sum = new Float64Array(4 ** n), num = new Float64Array(4 ** n);
  for (let s = 0; s < S.length; s++) {
    // E(mask) = Σ_x f(x) (−1)^{|x & mask|}, for every subset of qubits.
    const f = new Float64Array(d);
    for (const [x, c] of counts[s]) f[x] += c / shots;
    for (let mask = 0; mask < d; mask++) {
      let e = 0;
      for (let x = 0; x < d; x++) if (f[x]) e += popcount(x & mask) & 1 ? -f[x] : f[x];
      let code = 0;
      for (let q = 0; q < n; q++) if ((mask >> q) & 1) code += (S[s][q] + 1) * 4 ** q;
      sum[code] += e;
      num[code] += 1;
    }
  }
  const rho = new Float64Array(2 * d * d);
  for (let code = 0; code < 4 ** n; code++) {
    if (!num[code]) continue;
    const ev = sum[code] / num[code];
    // P|x⟩ = i^{#Y} (−1)^{|x & (Y ∪ Z)|} |x ⊕ (X ∪ Y)⟩.
    let flip = 0, sign = 0, ys = 0;
    for (let q = 0; q < n; q++) {
      const p = Math.floor(code / 4 ** q) % 4;
      if (p === 1 || p === 2) flip |= 1 << q;
      if (p === 2 || p === 3) sign |= 1 << q;
      if (p === 2) ys++;
    }
    const ir = [1, 0, -1, 0][ys % 4], ii = [0, 1, 0, -1][ys % 4];
    for (let x = 0; x < d; x++) {
      const y = x ^ flip, sg = popcount(x & sign) & 1 ? -1 : 1;
      rho[2 * (y * d + x)] += (ev * sg * ir) / d;
      rho[2 * (y * d + x) + 1] += (ev * sg * ii) / d;
    }
  }
  return rho;
}

const toComplex = (rho: Float64Array, d: number): Complex[][] =>
  Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => ({ re: rho[2 * (i * d + j)], im: rho[2 * (i * d + j) + 1] })));

/**
 * The nearest physical ρ (Smolin, Gambetta & Smith 2012): eigenvalues sorted
 * down, the most negative ones set to 0 and their weight spread over the rest
 * until none is negative; the eigenvectors are kept. Returns ρ, its
 * eigenvalues (descending) and eigenvectors.
 */
export function physical(rhoHat: Float64Array, d: number): { rho: Float64Array; values: number[]; vectors: Complex[][] } {
  const { values, vectors } = hermitianEig(toComplex(rhoHat, d));
  const order = values.map((_, k) => k).sort((a, b) => values[b] - values[a]);
  const mu = order.map((k) => values[k]);
  const vec = order.map((k) => vectors[k]);
  const lam = new Array<number>(d).fill(0);
  let a = 0, i = d;
  while (i > 0 && mu[i - 1] + a / i < 0) { a += mu[i - 1]; i--; }
  for (let j = 0; j < i; j++) lam[j] = mu[j] + a / i;
  const rho = new Float64Array(2 * d * d);
  for (let k = 0; k < d; k++) {
    if (!lam[k]) continue;
    const v = vec[k];
    for (let r = 0; r < d; r++) for (let c = 0; c < d; c++) {
      rho[2 * (r * d + c)] += lam[k] * (v[r].re * v[c].re + v[r].im * v[c].im);
      rho[2 * (r * d + c) + 1] += lam[k] * (v[r].im * v[c].re - v[r].re * v[c].im);
    }
  }
  return { rho, values: lam, vectors: vec };
}

/** The leading eigenvector as a state (re/im interleaved), global phase set so its largest amplitude is real and positive. */
export function leadingState(vector: Complex[]): Float64Array {
  let big = 0;
  for (let i = 1; i < vector.length; i++) if (vector[i].re ** 2 + vector[i].im ** 2 > vector[big].re ** 2 + vector[big].im ** 2) big = i;
  const m = Math.hypot(vector[big].re, vector[big].im) || 1;
  const cr = vector[big].re / m, ci = -vector[big].im / m; // multiply by e^{−i arg}
  const st = new Float64Array(2 * vector.length);
  vector.forEach((z, i) => { st[2 * i] = z.re * cr - z.im * ci; st[2 * i + 1] = z.re * ci + z.im * cr; });
  return st;
}

/**
 * One tomography run: all 3ⁿ settings, `shots` each, drawn from `probsOf`
 * (setting → outcome distribution) with `rngOf(setting index)`. Returns the
 * counts, ρ̂ (linear inversion), the physical ρ, and the leading state with its
 * weight λ₁.
 */
export function tomography(n: number, shots: number, probsOf: (s: Basis[]) => Float64Array, rngOf: (s: number) => () => number, readout: number[] = []) {
  const S = settings(n);
  const counts = S.map((s, k) => drawCounts(probsOf(s), shots, rngOf(k), readout));
  const rhoHat = linearInversion(n, counts, shots);
  const { rho, values, vectors } = physical(rhoHat, 1 << n);
  return { counts, rhoHat, rho, lambda: values[0], state: leadingState(vectors[0]), settings: S.length };
}

/**
 * Bloch vectors from three experiments (all qubits in X, in Y, in Z; `shots`
 * each): each coordinate is 1 − 2·f(1) of that qubit, with its standard error
 * √((1 − c²)/N).
 */
export function blochFromCounts(n: number, x: Map<number, number>, y: Map<number, number>, z: Map<number, number>, shots: number) {
  const coord = (counts: Map<number, number>, q: number) => {
    let ones = 0;
    for (const [i, c] of counts) if ((i >> q) & 1) ones += c;
    return 1 - (2 * ones) / shots;
  };
  const se = (c: number) => Math.sqrt(Math.max(0, 1 - c * c) / shots);
  const vectors = Array.from({ length: n }, (_, q) => ({ x: coord(x, q), y: coord(y, q), z: coord(z, q) }));
  return { vectors, errors: vectors.map((v) => ({ x: se(v.x), y: se(v.y), z: se(v.z) })) };
}
