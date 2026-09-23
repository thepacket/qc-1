import { mulberry32 } from "../sim/measure";
import { applyStep, type Entry, type Scope } from "./steps";

/**
 * Are two unitary tapes the same operator, up to a global phase?
 *
 * Small registers (n ≤ FULL_MAX) compare every column of the two unitaries
 * against one common phase — an exact operator check. Larger ones compare
 * the images of a few random states (with one common phase too), which a
 * different operator matches with probability zero.
 *
 * `perm` accounts for routing: tape B leaves logical qubit l on physical
 * qubit perm[l], so B = P·A with P that qubit permutation.
 */

export const FULL_MAX = 8;
const TOL = 1e-8;

export type EquivResult = {
  equal: boolean;
  /** Largest amplitude difference after aligning the global phase. */
  maxErr: number;
  /** "unitary" (every column) or "sampled" (random states). */
  method: "unitary" | "sampled";
};

function run(n: number, tape: Entry[], state: Float64Array, scope: Scope) {
  const cbits = new Uint8Array(n);
  for (const e of tape) for (const s of e) applyStep(state, n, s, Math.random, scope, cbits);
}

/** Move the amplitude of each basis index to the index with logical bit l placed at physical bit perm[l]. */
export function permuteQubits(state: Float64Array, n: number, perm: number[]): Float64Array {
  const out = new Float64Array(state.length);
  const dim = 1 << n;
  for (let i = 0; i < dim; i++) {
    let j = 0;
    for (let l = 0; l < n; l++) if ((i >> (n - 1 - l)) & 1) j |= 1 << (n - 1 - perm[l]);
    out[2 * j] = state[2 * i];
    out[2 * j + 1] = state[2 * i + 1];
  }
  return out;
}

export function equivalent(n: number, a: Entry[], b: Entry[], opts: { scope?: Scope; perm?: number[] } = {}): EquivResult {
  const scope = opts.scope ?? {};
  const dim = 1 << n;
  const full = n <= FULL_MAX;
  const inputs: Float64Array[] = [];
  if (full) {
    for (let j = 0; j < dim; j++) {
      const s = new Float64Array(2 * dim);
      s[2 * j] = 1;
      inputs.push(s);
    }
  } else {
    const r = mulberry32(0x5eed + n);
    for (let k = 0; k < 3; k++) {
      const s = new Float64Array(2 * dim);
      let norm = 0;
      for (let i = 0; i < 2 * dim; i++) norm += (s[i] = r() - 0.5) ** 2;
      for (let i = 0; i < 2 * dim; i++) s[i] /= Math.sqrt(norm);
      inputs.push(s);
    }
  }
  const outA: Float64Array[] = [], outB: Float64Array[] = [];
  for (const s of inputs) {
    const x = s.slice(), y = s.slice();
    run(n, a, x, scope);
    run(n, b, y, scope);
    outA.push(opts.perm ? permuteQubits(x, n, opts.perm) : x);
    outB.push(y);
  }
  // Global phase from the largest amplitude of A's images: B = e^{iφ} A.
  let best = -1, bk = 0, bi = 0;
  outA.forEach((x, k) => {
    for (let i = 0; i < dim; i++) {
      const m = x[2 * i] ** 2 + x[2 * i + 1] ** 2;
      if (m > best) { best = m; bk = k; bi = i; }
    }
  });
  const [ar, ai] = [outA[bk][2 * bi], outA[bk][2 * bi + 1]];
  const [br, bim] = [outB[bk][2 * bi], outB[bk][2 * bi + 1]];
  // e^{iφ} = b / a
  const d = ar * ar + ai * ai;
  const pr = (br * ar + bim * ai) / d, pi = (bim * ar - br * ai) / d;
  let maxErr = Math.abs(Math.hypot(pr, pi) - 1);
  outA.forEach((x, k) => {
    const y = outB[k];
    for (let i = 0; i < dim; i++) {
      const re = pr * x[2 * i] - pi * x[2 * i + 1], im = pr * x[2 * i + 1] + pi * x[2 * i];
      maxErr = Math.max(maxErr, Math.hypot(re - y[2 * i], im - y[2 * i + 1]));
    }
  });
  return { equal: maxErr < TOL, maxErr, method: full ? "unitary" : "sampled" };
}
