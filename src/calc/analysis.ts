/**
 * Read-outs of a statevector for the display views. These run in the
 * simulator worker next to the state, so only small summaries cross over.
 */

export type Vec3 = { x: number; y: number; z: number };

/** Indices with the largest probabilities, at most k, highest first. */
export function topK(state: Float64Array, k: number, eps = 1e-12): { idx: number[]; nonzero: number } {
  const dim = state.length >> 1;
  const nz: number[] = [];
  const pr = new Float64Array(dim);
  for (let i = 0; i < dim; i++) {
    const p = state[2 * i] ** 2 + state[2 * i + 1] ** 2;
    pr[i] = p;
    if (p > eps) nz.push(i);
  }
  const nonzero = nz.length;
  let keep = nz;
  if (nonzero > k) {
    // The k-th largest probability by quickselect (linear time), then everything above it and ties up to k.
    const vals = Float64Array.from(nz, (i) => pr[i]);
    const kth = select(vals, k - 1);
    keep = [];
    for (const i of nz) if (pr[i] > kth) keep.push(i);
    for (const i of nz) { if (keep.length >= k) break; if (pr[i] === kth) keep.push(i); }
  }
  const idx = keep.sort((a, b) => pr[b] - pr[a] || a - b);
  return { idx, nonzero };
}

/** The value of rank r (0 = largest) in `a` (reordered in place): Hoare quickselect. */
function select(a: Float64Array, r: number): number {
  let lo = 0, hi = a.length - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] > pivot) i++;
      while (a[j] < pivot) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (r <= j) hi = j;
    else if (r >= i) lo = i;
    else return a[r];
  }
  return a[r];
}

/** Bloch vector of qubit q by partial trace (qubit q is bit q, as in Qiskit). */
export function bloch(state: Float64Array, n: number, q: number): Vec3 {
  const mask = 1 << q;
  const dim = 1 << n;
  // c01 = Σ conj(a₀)·a₁ over pairs differing only in bit q, so ρ₀₁ = conj(c01):
  // ⟨X⟩ = 2 Re c01, ⟨Y⟩ = 2 Im c01 (|+i⟩ → +1), ⟨Z⟩ = ρ₀₀ − ρ₁₁.
  // Blocks of `mask` indices with bit q = 0 are followed by their bit-q = 1
  // partners, so walk the pairs directly with no branch.
  let r00 = 0, r11 = 0, re01 = 0, im01 = 0;
  for (let base = 0; base < dim; base += mask << 1) {
    for (let i = base, end = base + mask; i < end; i++) {
      const a = state[2 * i], b = state[2 * i + 1];
      const j = i + mask;
      const c = state[2 * j], d = state[2 * j + 1];
      r00 += a * a + b * b;
      r11 += c * c + d * d;
      re01 += a * c + b * d;
      im01 += a * d - b * c;
    }
  }
  return { x: 2 * re01, y: 2 * im01, z: r00 - r11 };
}

/**
 * Sample `shots` measurements of all qubits straight from the state:
 * cumulative distribution + binary search, tallied sparsely.
 */
export function sampleState(state: Float64Array, shots: number, rng: () => number = Math.random): Map<number, number> {
  const dim = state.length >> 1;
  const cum = new Float64Array(dim);
  let total = 0;
  for (let i = 0; i < dim; i++) {
    total += state[2 * i] ** 2 + state[2 * i + 1] ** 2;
    cum[i] = total;
  }
  const counts = new Map<number, number>();
  for (let s = 0; s < shots; s++) {
    const u = rng() * total;
    let lo = 0, hi = dim - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (u < cum[mid]) hi = mid;
      else lo = mid + 1;
    }
    counts.set(lo, (counts.get(lo) ?? 0) + 1);
  }
  return counts;
}
