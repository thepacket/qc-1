/**
 * Read-outs of a statevector for the display views. These run in the
 * simulator worker next to the state, so only small summaries cross over.
 */

export type Vec3 = { x: number; y: number; z: number };

/** Indices with the largest probabilities, at most k, highest first. */
export function topK(state: Float64Array, k: number, eps = 1e-12): { idx: number[]; nonzero: number } {
  const dim = state.length >> 1;
  const idx: number[] = [];
  const pr: number[] = [];
  let nonzero = 0;
  for (let i = 0; i < dim; i++) {
    const p = state[2 * i] ** 2 + state[2 * i + 1] ** 2;
    if (p <= eps) continue;
    nonzero++;
    if (idx.length === k && p <= pr[k - 1]) continue;
    let j = idx.length < k ? idx.length : k - 1;
    while (j > 0 && pr[j - 1] < p) {
      idx[j] = idx[j - 1];
      pr[j] = pr[j - 1];
      j--;
    }
    idx[j] = i;
    pr[j] = p;
  }
  return { idx, nonzero };
}

/** Bloch vector of qubit q by partial trace (big-endian: q0 is the MSB). */
export function bloch(state: Float64Array, n: number, q: number): Vec3 {
  const mask = 1 << (n - 1 - q);
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
