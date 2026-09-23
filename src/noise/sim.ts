/**
 * Noisy simulation of a tape under a NoiseModel (semantics in model.ts):
 *
 *   - `noisyDensity`: the exact density matrix, for unitary tapes (no
 *     measurement, reset, prep or IF) up to DENSITY_MAX qubits;
 *   - `runTrajectories`: quantum trajectories (Monte-Carlo wavefunction):
 *     every channel sampled from its Kraus/Pauli unravelling, measurements
 *     sampled afresh (not the recorded outcomes), readout flips on the
 *     recorded bits, IF on those (noisy) bits. Averages converge to ρ.
 *
 * Both follow the exported program instruction by instruction, so they match
 * Qiskit Aer on QC-1's QASM export (fixture `noise`).
 */
import { applyStep, exportedSteps, MEASURE_IDS, NONUNITARY, type Entry, type Scope, type Step } from "../calc/steps";
import { applyKQubit } from "../sim/apply";
import { mulberry32 } from "../sim/measure";
import type { Matrix } from "../sim/matrices";
import { channelsAfter, pauliMatrix, type Channel } from "./channels";
import { rate, type NoiseModel } from "./model";

export const DENSITY_MAX = 10;

/** True when the density-matrix path applies. */
export function densityOk(n: number, tape: Entry[]): boolean {
  return n <= DENSITY_MAX && tape.every((e) => e.every((s) => !s.condition && !NONUNITARY.has(s.gateId)));
}

const steps = (tape: Entry[]) => tape.flat().flatMap(exportedSteps);

// ─── Density matrix ────────────────────────────────────────────────────

/** ρ (row-major, re/im interleaved, dim² entries). */
export type Density = { n: number; rho: Float64Array };

function column(rho: Float64Array, d: number, j: number, out: Float64Array) {
  for (let i = 0; i < d; i++) { out[2 * i] = rho[2 * (i * d + j)]; out[2 * i + 1] = rho[2 * (i * d + j) + 1]; }
}
function setColumn(rho: Float64Array, d: number, j: number, v: Float64Array) {
  for (let i = 0; i < d; i++) { rho[2 * (i * d + j)] = v[2 * i]; rho[2 * (i * d + j) + 1] = v[2 * i + 1]; }
}
function dagger(rho: Float64Array, d: number): Float64Array {
  const out = new Float64Array(rho.length);
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    out[2 * (j * d + i)] = rho[2 * (i * d + j)];
    out[2 * (j * d + i) + 1] = -rho[2 * (i * d + j) + 1];
  }
  return out;
}

/** A·M for an operation `op` applied to every column of M. */
function leftApply(M: Float64Array, d: number, op: (v: Float64Array) => void): Float64Array {
  const out = new Float64Array(M.length), v = new Float64Array(2 * d);
  for (let j = 0; j < d; j++) {
    column(M, d, j, v);
    op(v);
    setColumn(out, d, j, v);
  }
  return out;
}

/** K ρ K† with K given as an operation on vectors: (K (K ρ)†)†. */
export function conjugate(rho: Float64Array, d: number, op: (v: Float64Array) => void): Float64Array {
  return dagger(leftApply(dagger(leftApply(rho, d, op), d), d, op), d);
}

function applyChannelDensity(rho: Float64Array, n: number, c: Channel): Float64Array {
  const d = 1 << n;
  const k = c.qubits.length;
  const ops: { scale: number; M: Matrix }[] = c.kind === "kraus"
    ? c.ops.map((M) => ({ scale: 1, M }))
    : [{ scale: 1 - (4 ** k - 1) * c.p, M: pauliMatrix(0, k) }, ...Array.from({ length: 4 ** k - 1 }, (_, i) => ({ scale: c.p, M: pauliMatrix(i + 1, k) }))];
  const out = new Float64Array(rho.length);
  for (const { scale, M } of ops) {
    if (scale === 0) continue;
    const t = conjugate(rho, d, (v) => applyKQubit(v, n, c.qubits, M));
    for (let i = 0; i < out.length; i++) out[i] += scale * t[i];
  }
  return out;
}

export function noisyDensity(n: number, tape: Entry[], scope: Scope, m: NoiseModel, initial?: Float64Array): Density {
  if (!densityOk(n, tape)) throw new Error(`density matrix: unitary circuits up to ${DENSITY_MAX} qubits`);
  const d = 1 << n;
  let rho: Float64Array = new Float64Array(2 * d * d);
  if (initial) {
    // |ψ⟩⟨ψ| of a given starting state
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
      rho[2 * (i * d + j)] = initial[2 * i] * initial[2 * j] + initial[2 * i + 1] * initial[2 * j + 1];
      rho[2 * (i * d + j) + 1] = initial[2 * i + 1] * initial[2 * j] - initial[2 * i] * initial[2 * j + 1];
    }
  } else rho[0] = 1;
  for (const s of steps(tape)) {
    rho = conjugate(rho, d, (v) => applyStep(v, n, s, Math.random, scope));
    for (const c of channelsAfter(m, s)) rho = applyChannelDensity(rho, n, c);
  }
  return { n, rho };
}

// ─── Trajectories ──────────────────────────────────────────────────────

function normalise(v: Float64Array) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const k = 1 / Math.sqrt(s);
  for (let i = 0; i < v.length; i++) v[i] *= k;
}

function sampleChannel(state: Float64Array, n: number, c: Channel, rng: () => number) {
  const k = c.qubits.length;
  if (c.kind === "pauli") {
    const total = (4 ** k - 1) * c.p;
    const r = rng();
    if (r >= total) return;
    const which = 1 + Math.min(4 ** k - 2, Math.floor(r / c.p));
    applyKQubit(state, n, c.qubits, pauliMatrix(which, k));
    return;
  }
  // Kraus unravelling: branch i with probability ‖K_i ψ‖².
  let r = rng();
  for (let i = 0; i < c.ops.length; i++) {
    const t = state.slice();
    applyKQubit(t, n, c.qubits, c.ops[i]);
    let p = 0;
    for (let j = 0; j < t.length; j++) p += t[j] * t[j];
    if (r < p || i === c.ops.length - 1) {
      if (p < 1e-300) continue;
      state.set(t);
      normalise(state);
      return;
    }
    r -= p;
  }
}

export type TrajectoryEnd = (state: Float64Array, bits: Uint8Array, rng: () => number) => void;

/**
 * Run `trajectories` noisy histories from |0…0⟩, calling `end` with each
 * final state and its classical bits (readout flips included).
 */
export function runTrajectories(n: number, tape: Entry[], scope: Scope, m: NoiseModel, end: TrajectoryEnd, opts: { trajectories?: number; seed?: number } = {}) {
  const T = Math.max(1, opts.trajectories ?? m.trajectories);
  const rng = mulberry32(opts.seed ?? 0x1eaf);
  const list = steps(tape);
  const chans = new Map<Step, Channel[]>(list.map((s) => [s, NONUNITARY.has(s.gateId) ? [] : channelsAfter(m, s)]));
  const dim = 1 << n;
  for (let t = 0; t < T; t++) {
    const state = new Float64Array(2 * dim);
    state[0] = 1;
    const bits = new Uint8Array(n);
    for (const s of list) {
      if (s.condition && bits[s.condition.clbit] !== s.condition.value) continue;
      if (MEASURE_IDS.has(s.gateId)) {
        const fresh: Step = { ...s, condition: undefined, outcome: undefined };
        const done = applyStep(state, n, fresh, rng, scope);
        if (s.gateId !== "reset") {
          const q = s.targets[0];
          bits[q] = (done.outcome ?? 0) ^ (rng() < rate(m, "readout", q) ? 1 : 0);
        }
        continue;
      }
      applyStep(state, n, { ...s, condition: undefined, outcome: undefined }, rng, scope);
      for (const c of chans.get(s)!) sampleChannel(state, n, c, rng);
    }
    end(state, bits, rng);
  }
}

// ─── Derived quantities ────────────────────────────────────────────────

export type NoisyStats = {
  /** Basis probabilities of the final state (no readout error). */
  probs: Float64Array;
  /** Bloch vectors per qubit. */
  bloch: { x: number; y: number; z: number }[];
  /** "density" (exact) or "trajectories" (T samples). */
  method: "density" | "trajectories";
  trajectories: number;
  /** Workers that ran the trajectories (parallel.ts); absent when they ran in place. */
  workers?: number;
};

function blochFromDensity(rho: Float64Array, n: number, q: number) {
  const d = 1 << n, mask = 1 << (n - 1 - q);
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < d; i++) {
    const p = rho[2 * (i * d + i)];
    z += i & mask ? -p : p;
    if (!(i & mask)) {
      const j = i | mask;
      // ⟨X⟩ = 2 Re ρ_{j,i}, ⟨Y⟩ = 2 Im ρ_{j,i} (ρ_{1,0} off-diagonal of the qubit)
      x += 2 * rho[2 * (j * d + i)];
      y += 2 * rho[2 * (j * d + i) + 1];
    }
  }
  return { x, y, z };
}

/** One chunk of trajectories, as sums: probabilities, Bloch components (x, y, z per qubit), and the count. */
export type TrajSums = { T: number; probs: Float64Array; bloch: Float64Array };

export function trajectorySums(n: number, tape: Entry[], scope: Scope, m: NoiseModel, T: number, seed: number): TrajSums {
  const dim = 1 << n;
  const probs = new Float64Array(dim), bloch = new Float64Array(3 * n);
  let count = 0;
  runTrajectories(n, tape, scope, m, (st) => {
    count++;
    for (let i = 0; i < dim; i++) probs[i] += st[2 * i] ** 2 + st[2 * i + 1] ** 2;
    for (let q = 0; q < n; q++) {
      const mask = 1 << (n - 1 - q);
      for (let i = 0; i < dim; i++) {
        if (i & mask) continue;
        const j = i | mask;
        const [ar, ai, br, bi] = [st[2 * i], st[2 * i + 1], st[2 * j], st[2 * j + 1]];
        bloch[3 * q] += 2 * (ar * br + ai * bi);
        bloch[3 * q + 1] += 2 * (ar * bi - ai * br);
        bloch[3 * q + 2] += ar * ar + ai * ai - br * br - bi * bi;
      }
    }
  }, { trajectories: T, seed });
  return { T: count, probs, bloch };
}

/**
 * Trajectories always run as TRAJ_CHUNKS chunks with their own seeds, merged
 * in chunk order, so the result is the same whether the chunks run one after
 * another (noisyStats) or on parallel workers (parallel.ts).
 */
export const TRAJ_CHUNKS = 8;

export function trajectoryChunks(T: number, seed: number): { T: number; seed: number }[] {
  const base = Math.floor(T / TRAJ_CHUNKS), extra = T % TRAJ_CHUNKS;
  return Array.from({ length: TRAJ_CHUNKS }, (_, k) => ({ T: base + (k < extra ? 1 : 0), seed: (seed + Math.imul(k, 0x9e3779b9)) >>> 0 })).filter((c) => c.T > 0);
}

export function mergeSums(n: number, parts: TrajSums[]): NoisyStats {
  const probs = new Float64Array(1 << n), b = new Float64Array(3 * n);
  let T = 0;
  for (const p of parts) {
    T += p.T;
    for (let i = 0; i < probs.length; i++) probs[i] += p.probs[i];
    for (let i = 0; i < b.length; i++) b[i] += p.bloch[i];
  }
  for (let i = 0; i < probs.length; i++) probs[i] /= T;
  return { probs, bloch: Array.from({ length: n }, (_, q) => ({ x: b[3 * q] / T, y: b[3 * q + 1] / T, z: b[3 * q + 2] / T })), method: "trajectories", trajectories: T };
}

export function noisyStats(n: number, tape: Entry[], scope: Scope, m: NoiseModel, opts: { trajectories?: number; seed?: number } = {}): NoisyStats {
  const dim = 1 << n;
  if (densityOk(n, tape)) {
    const { rho } = noisyDensity(n, tape, scope, m);
    const probs = new Float64Array(dim);
    for (let i = 0; i < dim; i++) probs[i] = rho[2 * (i * dim + i)];
    return { probs, bloch: Array.from({ length: n }, (_, q) => blochFromDensity(rho, n, q)), method: "density", trajectories: 0 };
  }
  const chunks = trajectoryChunks(Math.max(1, opts.trajectories ?? m.trajectories), opts.seed ?? 0x1eaf);
  return mergeSums(n, chunks.map((c) => trajectorySums(n, tape, scope, m, c.T, c.seed)));
}

/** Shot counts: final-state samples with readout flips on every bit. */
export function noisyShots(n: number, probs: Float64Array, m: NoiseModel, shots: number, seed = 0x5407): Map<number, number> {
  const rng = mulberry32(seed);
  const cdf = new Float64Array(probs.length);
  let acc = 0;
  for (let i = 0; i < probs.length; i++) cdf[i] = acc += probs[i];
  const out = new Map<number, number>();
  for (let s = 0; s < shots; s++) {
    const r = rng() * acc;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
    let x = lo;
    for (let q = 0; q < n; q++) if (rng() < rate(m, "readout", q)) x ^= 1 << (n - 1 - q);
    out.set(x, (out.get(x) ?? 0) + 1);
  }
  return out;
}
