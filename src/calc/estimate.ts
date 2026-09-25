/**
 * Views as on hardware (Hardware experiment): each periodic run is a set of
 * experiments of N shots each, and while runs are on the views show what
 * those shots give, fluctuating from run to run:
 *
 *  - Z experiment (the SHOTS sample): PROB, each outcome's frequency f with its
 *    standard error √(f(1−f)/N), and the Z-only LAB panels (Σ √fᵢ |i⟩);
 *  - X and Y experiments (every qubit in X, in Y): BLOCH x and y, z from Z;
 *  - state tomography (all 3ⁿ Pauli settings, n ≤ TOMO_MAX, tomography.ts):
 *    STATE is the reconstructed state (the leading eigenvector of ρ̂), and the
 *    LAB panels that read the state run on it. Above TOMO_MAX, STATE shows
 *    √f and says the phases aren't measured.
 */
import type { ViewData } from "./core";
import type { Vec3 } from "./analysis";
import { blochFromCounts, confusion, IDEAL_DEVICE, mitigateCounts, qubitP1, rhoProbs, rhoProbsNoisy, stateProbs, tomography, TOMO_MAX, type Basis, type Device } from "./tomography";

/** Most rows listed (as KET_ROWS in core.ts). */
const ROWS = 4096;

/** Experiments of a run, for their seeds (a tomography setting k is TOMO + k). */
export const EXP = { Z: 0, X: 1, Y: 2, TOMO: 16 } as const;

/** A seeded generator for experiment `exp` of run `seed`: every view of a run draws the same shots. */
export function shotRng(seed: number, exp = 0): () => number {
  let s = (0x5407 + seed + Math.imul(exp, 0x9e3779b1)) >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32);
}

/** Outcomes of the sample, the most frequent first, at most ROWS, then in basis order. */
function listed(counts: Map<number, number>): [number, number][] {
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, ROWS);
  return top.sort((a, b) => a[0] - b[0]);
}

/** What a run measured, for estimateView. */
export type RunSource = {
  /** The Z experiment (the SHOTS sample). */
  z: Map<number, number>;
  /** Each qubit's exact Bloch vector (ideal, or under noise): its X and Y experiments' outcome distributions. */
  bloch: () => Vec3[];
  /** Joint basis experiment for circuits whose measurements must be replayed. */
  basisCounts?: (basis: 0 | 1) => Map<number, number>;
  /** How it measures (readout errors, noisy basis changes; ideal without noise). */
  device: Device;
  /** Undo the readout confusion on every count before estimating. */
  mitigate?: boolean;
  seed: number;
  /** State tomography of the run (n ≤ TOMO_MAX), made on demand. */
  tomography: () => { state: Float64Array; lambda: number; settings: number } | null;
};

/**
 * An X (or Y) experiment: every qubit measured in that basis. Each qubit's
 * outcome follows its exact marginal, (1 ∓ r)/2 flipped by readout error, which
 * is what that experiment gives qubit by qubit (Bloch estimates use no joint
 * statistics).
 */
function basisExperiment(n: number, exact: Vec3[], basis: 0 | 1, shots: number, rng: () => number, device: Device): Map<number, number> {
  const p1 = exact.map((v, q) => qubitP1(v, q, basis, device));
  const out = new Map<number, number>();
  for (let s = 0; s < shots; s++) {
    let x = 0;
    for (let q = 0; q < n; q++) if (rng() < p1[q]) x |= 1 << q;
    out.set(x, (out.get(x) ?? 0) + 1);
  }
  return out;
}

/** STATE, PROB or BLOCH from a run's experiments. */
export function estimateView(mode: "ket" | "prob" | "bloch", n: number, shots: number, run: RunSource): ViewData {
  const fix = (c: Map<number, number>) => (run.mitigate && run.device.readout.length ? mitigateCounts(c, n, run.device.readout) : c);
  // PROB needs a distribution: mitigated quasi-counts clipped at 0 and renormalised.
  const clip = (c: Map<number, number>) => {
    if (!run.mitigate || !run.device.readout.length) return c;
    const total = [...c.values()].reduce((a, v) => a + Math.max(0, v), 0) || 1;
    return new Map([...c].filter(([, v]) => v > 0).map(([i, v]) => [i, (v / total) * shots]));
  };
  const counts = clip(fix(run.z));
  if (mode === "bloch") {
    const exact = run.bloch();
    const x = run.basisCounts?.(0) ?? basisExperiment(n, exact, 0, shots, shotRng(run.seed, EXP.X), run.device);
    const y = run.basisCounts?.(1) ?? basisExperiment(n, exact, 1, shots, shotRng(run.seed, EXP.Y), run.device);
    const { vectors, errors } = blochFromCounts(n, fix(x), fix(y), fix(run.z), shots);
    if (run.mitigate && run.device.readout.length) {
      const raw = blochFromCounts(n, x, y, run.z, shots).errors;
      errors.forEach((v, q) => {
        const [p01, p10] = run.device.readout[q] ?? [0, 0], det = 1 - p01 - p10;
        v.x = raw[q].x / det; v.y = raw[q].y / det; v.z = raw[q].z / det;
      });
    }
    return { n, mode: "bloch", estimate: { shots, experiments: "X, Y and Z experiments" }, vectors, errors };
  }
  if (mode === "prob") {
    const estimate = { shots };
    const corrected = run.mitigate && run.device.readout.length ? mitigatedProbabilityErrors(n, run.z, shots, run.device) : null;
    const se = (f: number, i: number) => corrected ? corrected[i] : Math.sqrt((f * (1 - f)) / shots);
    if (n <= 4) {
      const rows = [...Array(1 << n).keys()].map((i) => { const p = (counts.get(i) ?? 0) / shots; return { i, p, se: se(p, i) }; });
      return { n, mode: "prob", estimate, complete: true, restP: 0, rows };
    }
    const top = listed(counts);
    const rows = top.map(([i, c]) => ({ i, p: c / shots, se: se(c / shots, i) }));
    return { n, mode: "prob", estimate, complete: counts.size <= ROWS, restP: Math.max(0, 1 - rows.reduce((s, r) => s + r.p, 0)), rows };
  }
  const tomo = n <= TOMO_MAX ? run.tomography() : null;
  if (tomo) {
    const rows: { i: number; re: number; im: number }[] = [];
    for (let i = 0; i < 1 << n; i++) if (tomo.state[2 * i] ** 2 + tomo.state[2 * i + 1] ** 2 > 1e-8) rows.push({ i, re: tomo.state[2 * i], im: tomo.state[2 * i + 1] });
    return { n, mode: "ket", estimate: { shots, settings: tomo.settings, lambda: tomo.lambda }, nonzero: rows.length, restP: 0, rows };
  }
  const top = listed(counts);
  const rows = top.map(([i, c]) => ({ i, re: Math.sqrt(c / shots), im: 0 }));
  return { n, mode: "ket", estimate: { shots, magnitudes: true }, nonzero: counts.size, restP: Math.max(0, 1 - rows.reduce((s, r) => s + r.re * r.re, 0)), rows };
}

/** Delta-method covariance through inverse readout, clipping and normalization.
 * Away from clipping boundaries this propagates the multinomial covariance
 * without constructing its exponentially larger dense matrix.
 */
export function mitigatedProbabilityErrors(n: number, counts: Map<number, number>, shots: number, device: Device): Float64Array {
  const f = new Float64Array(2 ** n);
  for (const [i, c] of counts) f[i] = c / shots;
  const readout = device.readout, q = confusion(f, n, readout, true);
  const active = q.map(v => v > 0 ? 1 : 0);
  const total = q.reduce((a, v) => a + Math.max(0, v), 0) || 1;
  const t = confusion(active, n, readout, true, { transpose: true });
  const second = confusion(f, n, readout, true, { squared: true });
  const cross = confusion(f.map((v, i) => v * t[i]), n, readout, true);
  const normSecond = f.reduce((a, v, i) => a + v * t[i] ** 2, 0);
  return q.map((v, i) => {
    if (v <= 0) return 0;
    const p = v / total;
    return Math.sqrt(Math.max(0, second[i] - 2 * p * cross[i] + p * p * normSecond) / shots) / total;
  });
}

/** The state Σ √(countᵢ/N) |i⟩ (phases zero): exact for anything that reads only Z-basis probabilities. */
export function sampleStateVector(n: number, counts: Map<number, number>, shots: number): Float64Array {
  const st = new Float64Array(2 << n);
  for (const [i, c] of counts) st[2 * i] = Math.sqrt(c / shots);
  return st;
}

/**
 * A run's state tomography (n ≤ TOMO_MAX): all 3ⁿ settings, `shots` each, from
 * the pure state or from ρ (noise), with readout errors. Every setting has its
 * own seed within the run.
 */
export function stateTomography(n: number, shots: number, seed: number, source: { state: Float64Array } | { rho: Float64Array }, device: Device = IDEAL_DEVICE, exp: number = EXP.TOMO, mitigate = false) {
  if (n > TOMO_MAX) return null;
  const probsOf = (st: Basis[]) => ("state" in source && !device.superops
    ? stateProbs(source.state, n, st)
    : device.superops
      ? rhoProbsNoisy("rho" in source ? source.rho : outer(source.state), n, st, device.superops)
      : rhoProbs((source as { rho: Float64Array }).rho, n, st));
  return tomography(n, shots, probsOf, (k) => shotRng(seed, exp + k), device.readout, mitigate);
}

/** |ψ⟩⟨ψ| */
export function outer(st: Float64Array): Float64Array {
  const d = st.length >> 1, rho = new Float64Array(2 * d * d);
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    rho[2 * (i * d + j)] = st[2 * i] * st[2 * j] + st[2 * i + 1] * st[2 * j + 1];
    rho[2 * (i * d + j) + 1] = st[2 * i + 1] * st[2 * j] - st[2 * i] * st[2 * j + 1];
  }
  return rho;
}
