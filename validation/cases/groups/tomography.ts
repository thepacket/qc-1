import { linearInversion, physical, rhoProbs, settings, tomography, leadingState } from "../../../src/calc/tomography";
import { shotRng } from "../../../src/calc/estimate";
import { rng } from "../tapes";

/**
 * SHOTS → repeat's state tomography (src/calc/tomography.ts): seeded pure
 * states and mixed ρ on 1–4 qubits, 256 shots per setting. The reference
 * recomputes, from the same counts, the linear inversion, the
 * Smolin–Gambetta–Smith projection and the leading eigenvector, and checks
 * every setting's exact probabilities against Qiskit's DensityMatrix.
 */
export type TomoCase = { id: string; n: number; shots: number; seed: number; rho: number[]; readout: number[] };

function randomState(n: number, seed: number): Float64Array {
  const r = rng(seed), d = 1 << n;
  const v = Float64Array.from({ length: 2 * d }, () => r.next() * 2 - 1);
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

const outer = (st: Float64Array, w = 1, into?: Float64Array) => {
  const d = st.length >> 1, rho = into ?? new Float64Array(2 * d * d);
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    rho[2 * (i * d + j)] += w * (st[2 * i] * st[2 * j] + st[2 * i + 1] * st[2 * j + 1]);
    rho[2 * (i * d + j) + 1] += w * (st[2 * i + 1] * st[2 * j] - st[2 * i] * st[2 * j + 1]);
  }
  return rho;
};

export function cases(): TomoCase[] {
  const out: TomoCase[] = [];
  for (const n of [1, 2, 3, 4]) {
    out.push({ id: `pure${n}`, n, shots: 256, seed: 10 + n, rho: [...outer(randomState(n, 100 + n))], readout: [] });
    // A mixed ρ: two states, 0.7 / 0.3.
    const rho = outer(randomState(n, 200 + n), 0.7);
    outer(randomState(n, 300 + n), 0.3, rho);
    out.push({ id: `mixed${n}`, n, shots: 256, seed: 20 + n, rho: [...rho], readout: Array.from({ length: n }, (_, q) => 0.02 + 0.01 * q) });
  }
  out.push({ id: "pure2-few", n: 2, shots: 16, seed: 7, rho: [...outer(randomState(2, 777))], readout: [] }); // enough negative eigenvalues to exercise the projection
  return out;
}

export function compute(c: TomoCase) {
  const rho = Float64Array.from(c.rho);
  const S = settings(c.n);
  const probs = S.map((s) => [...rhoProbs(rho, c.n, s)]);
  const t = tomography(c.n, c.shots, (s) => rhoProbs(rho, c.n, s), (k) => shotRng(c.seed, 16 + k), c.readout);
  // The same pipeline, step by step, for the reference to follow.
  const rhoHat = linearInversion(c.n, t.counts, c.shots);
  const phys = physical(rhoHat, 1 << c.n);
  return {
    settings: S, probs,
    counts: t.counts.map((m) => [...m.entries()]),
    rhoHat: [...rhoHat], rho: [...phys.rho], values: phys.values,
    state: [...leadingState(phys.vectors[0])], lambda: t.lambda,
  };
}
