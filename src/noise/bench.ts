/**
 * Characterization and benchmarking under the noise model: randomized
 * benchmarking (standard, interleaved, unitarity, simultaneous), quantum
 * volume, cross-entropy benchmarking, mirror circuits and T1/T2 experiments.
 *
 * Circuits are ordinary tapes (so they export and can be checked in Qiskit);
 * their noisy outcomes come from the exact density matrix (small registers)
 * or trajectories. Decays are fitted as A·pᵐ + B with B free (upstream fixed
 * B = ½, which biases p whenever the noise isn't unital, e.g. amplitude
 * damping, and fitted in log space).
 */
import { mulberry32 } from "../sim/measure";
import { decomposeKAK4x4 } from "../sim/kak";
import type { Complex } from "../sim/complex";
import { Register } from "../calc/register";
import { applyStep, type Entry, type Step } from "../calc/steps";
import { densityOk, noisyDensity, noisyStats } from "./sim";
import type { NoiseModel } from "./model";
import { channelsAfter } from "./channels";

let sid = 0;
export const step = (gateId: string, targets: number[], controls: number[] = [], params: string[] = []): Step => ({
  id: `b${sid++}`, gateId, column: 0, targets, controls, clbits: [], params,
});

// ─── The single-qubit Clifford group (24 elements, BFS over H and S) ───

type C2 = number[]; // [re00, im00, re01, im01, re10, im10, re11, im11]
const mul2 = (X: C2, Y: C2): C2 => {
  const o = new Array(8).fill(0);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    const [xr, xi, yr, yi] = [X[(i * 2 + k) * 2], X[(i * 2 + k) * 2 + 1], Y[(k * 2 + j) * 2], Y[(k * 2 + j) * 2 + 1]];
    o[(i * 2 + j) * 2] += xr * yr - xi * yi;
    o[(i * 2 + j) * 2 + 1] += xr * yi + xi * yr;
  }
  return o;
};
const dag2 = (X: C2): C2 => [X[0], -X[1], X[4], -X[5], X[2], -X[3], X[6], -X[7]];
function key2(X: C2): string {
  let k = 0;
  while (Math.hypot(X[2 * k], X[2 * k + 1]) < 1e-6) k++;
  const m = Math.hypot(X[2 * k], X[2 * k + 1]), pr = X[2 * k] / m, pi = -X[2 * k + 1] / m;
  return [0, 1, 2, 3].map((i) => [X[2 * i] * pr - X[2 * i + 1] * pi, X[2 * i] * pi + X[2 * i + 1] * pr].map((v) => Math.round(v * 1e6) / 1e6 + 0).join(",")).join("|");
}
const H2: C2 = [Math.SQRT1_2, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0, -Math.SQRT1_2, 0];
const S2: C2 = [1, 0, 0, 0, 0, 0, 0, 1];
export const GATE2: Record<string, C2> = {
  i: [1, 0, 0, 0, 0, 0, 1, 0], x: [0, 0, 1, 0, 1, 0, 0, 0], y: [0, 0, 0, -1, 0, 1, 0, 0], z: [1, 0, 0, 0, 0, 0, -1, 0],
  h: H2, s: S2, sdg: [1, 0, 0, 0, 0, 0, 0, -1],
  sx: [0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5], sxdg: [0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5],
};

export type CliffordGroup = { gates: string[][]; comp: number[][]; inv: number[]; index: (g: string) => number };

let GROUP: CliffordGroup | null = null;
export function cliffordGroup(): CliffordGroup {
  if (GROUP) return GROUP;
  const mats: C2[] = [GATE2.i], seqs: string[][] = [[]], at = new Map<string, number>([[key2(GATE2.i), 0]]);
  for (let h = 0; h < mats.length && mats.length < 24; h++) {
    for (const [g, M] of [["h", H2], ["s", S2]] as const) {
      const X = mul2(M, mats[h]);
      const k = key2(X);
      if (!at.has(k)) { at.set(k, mats.length); mats.push(X); seqs.push([...seqs[h], g]); }
    }
  }
  const idx = (X: C2) => at.get(key2(X))!;
  const comp = mats.map((A) => mats.map((B) => idx(mul2(B, A)))); // apply i then j
  GROUP = { gates: seqs, comp, inv: mats.map((A) => idx(dag2(A))), index: (g) => idx(GATE2[g]) };
  return GROUP;
}

// ─── Fits ──────────────────────────────────────────────────────────────

/**
 * Least-squares fit y ≈ A·pˣ + B (p in (0, 1]): A, B linear for each p, p by golden section.
 * QC-1 fix (docs/quantiom-bugs.md #51): flat data (spread ≤ 1e-9) doesn't identify p: every p fits with A = 0, and the
 * minimiser would return an arbitrary one (0.003 for noiseless RB: an error of ½
 * per Clifford). Then `identifiable` is false and p is NaN; see `decayOrIdeal`.
 */
export function fitDecay(xs: number[], ys: number[], fixedB?: number): { A: number; B: number; p: number; identifiable: boolean; level: number } {
  const level = ys.reduce((a, b) => a + b, 0) / ys.length;
  const spread = Math.max(...ys) - Math.min(...ys);
  if (!(spread > 1e-9)) return { A: 0, B: fixedB ?? level, p: NaN, identifiable: false, level };
  const solve = (p: number) => {
    const f = xs.map((x) => p ** x);
    if (fixedB !== undefined) {
      const A = f.reduce((a, v, i) => a + v * (ys[i] - fixedB), 0) / (f.reduce((a, v) => a + v * v, 0) || 1);
      return { A, B: fixedB, err: ys.reduce((a, y, i) => a + (y - A * f[i] - fixedB) ** 2, 0) };
    }
    const n = xs.length, sf = f.reduce((a, b) => a + b, 0), sff = f.reduce((a, b) => a + b * b, 0);
    const sy = ys.reduce((a, b) => a + b, 0), sfy = f.reduce((a, v, i) => a + v * ys[i], 0);
    const det = n * sff - sf * sf;
    if (Math.abs(det) < 1e-300) return { A: 0, B: sy / n, err: Infinity };
    const A = (n * sfy - sf * sy) / det, B = (sy - A * sf) / n;
    return { A, B, err: ys.reduce((a, y, i) => a + (y - A * f[i] - B) ** 2, 0) };
  };
  // Coarse scan, then golden-section refinement around the best cell.
  let best = 0.5, bestErr = Infinity;
  for (let k = 1; k <= 400; k++) {
    const p = k / 400, e = solve(p).err;
    if (e < bestErr) { bestErr = e; best = p; }
  }
  let lo = Math.max(1e-9, best - 1 / 400), hi = Math.min(1, best + 1 / 400);
  const g = (Math.sqrt(5) - 1) / 2;
  let a = hi - g * (hi - lo), b = lo + g * (hi - lo), fa = solve(a).err, fb = solve(b).err;
  for (let it = 0; it < 200 && hi - lo > 1e-15; it++) {
    if (fa < fb) { hi = b; b = a; fb = fa; a = hi - g * (hi - lo); fa = solve(a).err; }
    else { lo = a; a = b; fa = fb; b = lo + g * (hi - lo); fb = solve(b).err; }
  }
  const p = (lo + hi) / 2, r = solve(p);
  return { A: r.A, B: r.B, p, identifiable: true, level };
}

/** True when the model attaches no error channel to any step of these tapes (so nothing can decay). */
export function noiselessOn(m: NoiseModel, tapes: Entry[][]): boolean {
  return tapes.every((t) => t.every((e) => e.every((st) => channelsAfter(m, st).length === 0)));
}

/**
 * The decay rate of a fit, with the one justified reading of flat data: when
 * the model puts no error channel on any gate that ran (`noiseless`, checked
 * from the model, not from the data) and the curve sits at its ideal value,
 * p = 1. A flat curve is not evidence of no noise: complete amplitude damping
 * (ad = 1) resets every state to |0⟩, so RB survival and purity are flat at 1
 * while the channel's unitarity is 0 (docs/quantiom-bugs.md #53). Any other
 * flat curve is NaN (not identifiable).
 */
export function decayOrIdeal(f: { p: number; level: number; identifiable: boolean }, ideal: number, noiseless: boolean): number {
  if (f.identifiable) return f.p;
  return noiseless && Math.abs(f.level - ideal) <= 1e-9 ? 1 : NaN;
}

// ─── Randomized benchmarking ───────────────────────────────────────────

/**
 * One RB sequence on qubit q: m random Cliffords (each followed by the gate
 * `interleave`), then the recovery. QC-1 fix: the interleaved gate runs as
 * itself (so its own per-gate noise applies); its Clifford index only tracks
 * the recovery (docs/quantiom-bugs.md #50). It used to be replaced by its H/S decomposition, so an X
 * with 20% depolarizing measured an error of 0.
 */
export function rbSequence(m: number, rng: () => number, q = 0, interleave: string | null = null): Entry[] {
  const G = cliffordGroup();
  const tape: Entry[] = [];
  let acc = 0;
  const push = (c: number) => { for (const g of G.gates[c]) tape.push([step(g, [q])]); acc = G.comp[acc][c]; };
  const inter = interleave !== null ? G.index(interleave) : -1;
  for (let k = 0; k < m; k++) {
    push(Math.floor(rng() * 24) % 24);
    if (interleave !== null) { tape.push([step(interleave, [q])]); acc = G.comp[acc][inter]; }
  }
  for (const g of G.gates[G.inv[acc]]) tape.push([step(g, [q])]);
  if (!tape.length) tape.push([step("i", [q])]);
  return tape;
}

export type RbCurve = { lengths: number[]; survival: number[]; A: number; B: number; p: number; epc: number; identifiable: boolean };

/** Exact P(0) of a one-qubit tape under the model. */
function survival1(tape: Entry[], m: NoiseModel): number {
  return noisyDensity(1, tape, {}, m).rho[0];
}

export function rb(m: NoiseModel, opts: { lengths?: number[]; sequences?: number; seed?: number; interleave?: string } = {}): RbCurve & { sequences: Entry[][][] } {
  const lengths = opts.lengths ?? [1, 2, 4, 8, 16, 32, 64];
  const K = opts.sequences ?? 12;
  const rng = mulberry32(opts.seed ?? 0x5eb);
  const seqs = lengths.map((len) => Array.from({ length: K }, () => rbSequence(len, rng, 0, opts.interleave ?? null)));
  const survival = seqs.map((ss) => ss.reduce((a, t) => a + survival1(t, m), 0) / K);
  const f = fitDecay(lengths, survival);
  const p = decayOrIdeal(f, 1, noiselessOn(m, seqs.flat()));
  return { lengths, survival, ...f, p, epc: (1 - p) / 2, sequences: seqs };
}

/** Purity-based unitarity: E[Tr ρ²]-like decay of the Bloch length² (Wallman et al. 2015), fitted as A·uᵐ⁻¹ + B. */
export function unitarity(m: NoiseModel, opts: { lengths?: number[]; sequences?: number; seed?: number } = {}) {
  const lengths = opts.lengths ?? [1, 2, 4, 8, 16, 32];
  const K = opts.sequences ?? 12;
  const rng = mulberry32(opts.seed ?? 0x0017);
  const G = cliffordGroup();
  const tapes: Entry[][][] = [];
  const purity = lengths.map((len) => {
    let acc = 0;
    tapes.push([]);
    for (let k = 0; k < K; k++) {
      const tape: Entry[] = [];
      for (let j = 0; j < len; j++) for (const g of G.gates[Math.floor(rng() * 24) % 24]) tape.push([step(g, [0])]);
      if (!tape.length) tape.push([step("i", [0])]);
      tapes[tapes.length - 1].push(tape);
      const r = noisyDensity(1, tape, {}, m).rho;
      // |Bloch|² = 2 Tr ρ² − 1
      const P = r[0] ** 2 + r[1] ** 2 + r[6] ** 2 + r[7] ** 2 + 2 * (r[2] ** 2 + r[3] ** 2);
      acc += 2 * P - 1;
    }
    return acc / K;
  });
  const f = fitDecay(lengths.map((l) => l - 1), purity);
  return { lengths, purity, u: decayOrIdeal(f, 1, noiselessOn(m, tapes.flat())), A: f.A, B: f.B, identifiable: f.identifiable, tapes };
}

// ─── Quantum volume ────────────────────────────────────────────────────

function gauss(rng: () => number) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

/** Haar-random U(4) (Gram–Schmidt of a complex Gaussian matrix). */
export function haar4(rng: () => number): Complex[][] {
  const cols: [number, number][][] = [];
  for (let c = 0; c < 4; c++) {
    const v: [number, number][] = Array.from({ length: 4 }, () => [gauss(rng), gauss(rng)]);
    for (const u of cols) {
      let pr = 0, pi = 0;
      for (let r = 0; r < 4; r++) { pr += u[r][0] * v[r][0] + u[r][1] * v[r][1]; pi += u[r][0] * v[r][1] - u[r][1] * v[r][0]; }
      for (let r = 0; r < 4; r++) { v[r][0] -= pr * u[r][0] - pi * u[r][1]; v[r][1] -= pr * u[r][1] + pi * u[r][0]; }
    }
    const nrm = Math.sqrt(v.reduce((a, [x, y]) => a + x * x + y * y, 0));
    cols.push(v.map(([x, y]) => [x / nrm, y / nrm]));
  }
  return Array.from({ length: 4 }, (_, r) => cols.map((c) => c[r] as unknown as Complex));
}

/** A 4×4 unitary as native tape steps on (a, b): KAK into U3 and RXX/RYY/RZZ (exact up to a global phase). */
export function su4Steps(U: Complex[][], a: number, b: number): Entry[] {
  const kak = decomposeKAK4x4(U.map((row) => row.map((e) => [e[0], e[1]] as Complex)));
  if (!kak) throw new Error("KAK failed");
  return kak.gates.map((g) => g.kind === "u3"
    ? [step("u3", [g.qubit === 0 ? a : b], [], [String(g.theta), String(g.phi), String(g.lambda)])]
    : [step(g.kind, [a, b], [], [String(g.theta)])]);
}

/** One QV model circuit: width m, m layers of Haar SU(4) on a random pairing. */
export function qvCircuit(m: number, rng: () => number): Entry[] {
  const tape: Entry[] = [];
  for (let layer = 0; layer < m; layer++) {
    const perm = Array.from({ length: m }, (_, i) => i);
    for (let i = m - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let k = 0; k + 1 < m; k += 2) tape.push(...su4Steps(haar4(rng), perm[k], perm[k + 1]));
  }
  return tape;
}

/** Heavy-output probability: the noisy probability of the outcomes above the ideal median. */
export function heavyOutput(n: number, tape: Entry[], m: NoiseModel): number {
  const ideal = new Register(n, tape).state;
  const pi = Array.from({ length: 1 << n }, (_, i) => ideal[2 * i] ** 2 + ideal[2 * i + 1] ** 2);
  const sorted = [...pi].sort((a, b) => a - b), h = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
  const noisy = noisyStats(n, tape, {}, m).probs;
  return pi.reduce((a, p, i) => a + (p > median ? noisy[i] : 0), 0);
}

export function quantumVolume(m: NoiseModel, opts: { widths?: number[]; circuits?: number; seed?: number } = {}) {
  const rng = mulberry32(opts.seed ?? 0x0a0a);
  const C = opts.circuits ?? 20;
  const rows = (opts.widths ?? [2, 3, 4]).map((w) => {
    const circuits = Array.from({ length: C }, () => qvCircuit(w, rng));
    const hops = circuits.map((t) => heavyOutput(w, t, m));
    const mean = hops.reduce((a, b) => a + b, 0) / C;
    const sd = Math.sqrt(hops.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, C - 1));
    // Pass: the mean heavy-output probability is above 2/3 with two-sigma confidence (Cross et al. 2019).
    const lower = mean - 2 * sd / Math.sqrt(C);
    return { width: w, hops, mean, lower, pass: lower > 2 / 3, circuits };
  });
  let largest = 1;
  for (const r of rows) { if (r.pass) largest = r.width; else break; }
  return { rows, qv: largest >= 2 ? 2 ** largest : 1 };
}

// ─── XEB ───────────────────────────────────────────────────────────────

const XEB_1Q = ["sx", "sy", "t"];

/** `depth` cycles of random one-qubit gates (never the same twice in a row) and a brickwork CZ layer. */
export function xebCircuit(n: number, depth: number, rng: () => number): Entry[] {
  const tape: Entry[] = [], prev = new Array<number>(n).fill(-1);
  for (let d = 0; d < depth; d++) {
    const layer: Step[] = [];
    for (let q = 0; q < n; q++) {
      let k = Math.floor(rng() * 3);
      if (k === prev[q]) k = (k + 1) % 3;
      prev[q] = k;
      layer.push(step(XEB_1Q[k], [q]));
    }
    tape.push(layer);
    for (let q = d % 2; q + 1 < n; q += 2) tape.push([step("z", [q + 1], [q])]);
  }
  return tape;
}

/** Linear XEB fidelity Σ(p−1/D)(q−1/D)/Σ(q−1/D)² (1 perfect, 0 uniform); null for a flat ideal distribution. */
export function linearXeb(ideal: number[], noisy: ArrayLike<number>): number | null {
  const D = ideal.length, u = 1 / D;
  let num = 0, den = 0;
  for (let i = 0; i < D; i++) { num += (noisy[i] - u) * (ideal[i] - u); den += (ideal[i] - u) ** 2; }
  return den > 1e-9 ? num / den : null;
}

export function xeb(m: NoiseModel, opts: { n?: number; depths?: number[]; circuits?: number; seed?: number } = {}) {
  const n = opts.n ?? 3, rng = mulberry32(opts.seed ?? 0x0eb);
  const depths = opts.depths ?? [1, 2, 4, 6, 8, 12];
  const C = opts.circuits ?? 8;
  const circuits = depths.map((d) => Array.from({ length: C }, () => xebCircuit(n, d, rng)));
  const perCircuit = circuits.map((cs) => cs.map((t) => {
    const s = new Register(n, t).state;
    const ideal = Array.from({ length: 1 << n }, (_, i) => s[2 * i] ** 2 + s[2 * i + 1] ** 2);
    return linearXeb(ideal, noisyStats(n, t, {}, m).probs);
  }));
  const fidelity = circuits.map((cs) => {
    const vals = cs.map((t) => {
      const s = new Register(n, t).state;
      const ideal = Array.from({ length: 1 << n }, (_, i) => s[2 * i] ** 2 + s[2 * i + 1] ** 2);
      return linearXeb(ideal, noisyStats(n, t, {}, m).probs);
    }).filter((v): v is number => v !== null);
    return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  });
  const f = fitDecay(depths, fidelity, 0);
  return { n, depths, fidelity, perCycle: decayOrIdeal(f, 1, noiselessOn(m, circuits.flat())), circuits, perCircuit };
}

// ─── Mirror circuits ───────────────────────────────────────────────────

/** Random Clifford layers (1q Cliffords and CZ pairs), then the exact inverse: ideally back to |0…0⟩. */
export function mirrorCircuit(width: number, depth: number, rng: () => number): Entry[] {
  const G = cliffordGroup();
  const fwd: Entry[] = [];
  for (let d = 0; d < depth; d++) {
    for (let q = 0; q < width; q++) for (const g of G.gates[Math.floor(rng() * 24) % 24]) fwd.push([step(g, [q])]);
    const perm = Array.from({ length: width }, (_, i) => i).sort(() => rng() - 0.5);
    for (let k = 0; k + 1 < width; k += 2) if (rng() < 0.5) fwd.push([step("z", [perm[k + 1]], [perm[k]])]);
  }
  const inv: Record<string, string> = { h: "h", s: "sdg", z: "z" };
  const back = [...fwd].reverse().map((e) => e.map((s) => ({ ...s, id: `${s.id}r`, gateId: inv[s.gateId] ?? s.gateId })));
  return [...fwd, ...back];
}

export function mirror(m: NoiseModel, opts: { widths?: number[]; depths?: number[]; circuits?: number; seed?: number } = {}) {
  const rng = mulberry32(opts.seed ?? 0x3140);
  const widths = opts.widths ?? [1, 2, 3, 4], depths = opts.depths ?? [1, 2, 4, 8];
  const C = opts.circuits ?? 6;
  const circuits: { width: number; depth: number; tape: Entry[]; success: number }[] = [];
  const success = widths.map((w) => depths.map((d) => {
    let acc = 0;
    for (let c = 0; c < C; c++) {
      const t = mirrorCircuit(w, d, rng);
      const s = densityOk(w, t) ? noisyDensity(w, t, {}, m).rho[0] : noisyStats(w, t, {}, m).probs[0];
      circuits.push({ width: w, depth: d, tape: t, success: s });
      acc += s;
    }
    return acc / C;
  }));
  return { widths, depths, success, circuits };
}

// ─── T1 / T2 ───────────────────────────────────────────────────────────

/** Idle experiments on one qubit, in units of identity gates: T1 (X, wait), Ramsey (H, wait, H), echo (H, wait/2, X, wait/2, H). */
export function t1t2(m: NoiseModel, opts: { delays?: number[] } = {}) {
  const delays = opts.delays ?? [0, 2, 4, 8, 16, 32, 64];
  const idle = (k: number) => Array.from({ length: k }, () => [step("i", [0])] as Entry);
  const ran: Entry[][] = [];
  const p = (tape: Entry[]) => { const t = tape.length ? tape : [[step("i", [0])]]; ran.push(t); return noisyDensity(1, t, {}, m).rho; };
  const t1 = delays.map((k) => p([[step("x", [0])], ...idle(k)])[6]); // P(1)
  const ramsey = delays.map((k) => p([[step("h", [0])], ...idle(k), [step("h", [0])]])[0]); // P(0)
  const echo = delays.map((k) => p([[step("h", [0])], ...idle(Math.floor(k / 2)), [step("x", [0])], ...idle(Math.ceil(k / 2)), [step("h", [0])]])[6]);
  const f1 = fitDecay(delays, t1), f2 = fitDecay(delays, ramsey), fe = fitDecay(delays, echo);
  const tau = (q: number) => (Number.isNaN(q) ? NaN : q >= 1 ? Infinity : -1 / Math.log(q));
  // Ideal values: P(1) after X is 1, P(0) after H·H is 1, P(1) after H·X·H is 0.
  const quiet = noiselessOn(m, ran);
  return { delays, t1, ramsey, echo, T1: tau(decayOrIdeal(f1, 1, quiet)), T2: tau(decayOrIdeal(f2, 1, quiet)), T2echo: tau(decayOrIdeal(fe, 0, quiet)), fits: { t1: f1, ramsey: f2, echo: fe } };
}

// ─── Repetition code ───────────────────────────────────────────────────

const popcount = (x: number) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
const syndromeOf = (e: number, d: number) => {
  let s = 0;
  for (let i = 0; i < d - 1; i++) s |= (((e >> i) & 1) ^ ((e >> (i + 1)) & 1)) << i;
  return s;
};

/** Minimum-weight correction for every syndrome of the distance-d bit-flip code. */
export function repetitionDecoder(d: number): Int32Array {
  const table = new Int32Array(1 << (d - 1)).fill(-1), weight = new Int32Array(1 << (d - 1)).fill(d + 1);
  for (let e = 0; e < 1 << d; e++) {
    const s = syndromeOf(e, d), w = popcount(e);
    if (w < weight[s]) { weight[s] = w; table[s] = e; }
  }
  return table;
}

/** Exact logical error rate with the minimum-weight decoder: more than d/2 flips. */
export function repetitionExact(d: number, p: number): number {
  let acc = 0, c = 1;
  for (let k = 0; k <= d; k++) {
    if (k > d / 2) acc += c * p ** k * (1 - p) ** (d - k);
    c = (c * (d - k)) / (k + 1);
  }
  return acc;
}

/** Monte-Carlo decoding with the lookup table (logical error = residual all-ones). */
export function repetitionMonteCarlo(d: number, p: number, shots: number, rng: () => number): number {
  const table = repetitionDecoder(d), ones = (1 << d) - 1;
  let fails = 0;
  for (let s = 0; s < shots; s++) {
    let e = 0;
    for (let q = 0; q < d; q++) if (rng() < p) e |= 1 << q;
    if ((e ^ table[syndromeOf(e, d)]) === ones) fails++;
  }
  return fails / shots;
}

// ─── Classical shadows ─────────────────────────────────────────────────


/**
 * Random-Pauli classical shadows of a state (Huang, Kueng & Preskill 2020):
 * each snapshot measures every qubit in a random X/Y/Z basis. A Pauli string
 * P is estimated by the mean over snapshots of Π_{q ∈ supp P} 3·b_q when every
 * basis matches P on its support (0 otherwise); median of means for robustness.
 */
export function classicalShadows(n: number, state: Float64Array, snapshots: number, seed = 0x5ad0) {
  const rng = mulberry32(seed);
  const bases = new Uint8Array(snapshots * n), bits = new Uint8Array(snapshots * n);
  const basisStep: Record<number, string[]> = { 0: ["h"], 1: ["sdg", "h"], 2: [] }; // X, Y, Z → Z
  for (let s = 0; s < snapshots; s++) {
    const st = state.slice();
    for (let q = 0; q < n; q++) {
      const b = Math.floor(rng() * 3);
      bases[s * n + q] = b;
      for (const g of basisStep[b]) applyStep(st, n, step(g, [q]), rng);
    }
    const done = [...Array(n).keys()].map((q) => applyStep(st, n, step("measure", [q]), rng).outcome ?? 0);
    done.forEach((o, q) => (bits[s * n + q] = o));
  }
  /** The single-snapshot estimator of ⟨P⟩ for every snapshot. */
  const values = (pauli: string) => {
    const vals: number[] = [];
    for (let s = 0; s < snapshots; s++) {
      let v = 1;
      for (let q = 0; q < n && v !== 0; q++) {
        const P = pauli[q];
        if (P === "I") continue;
        const want = P === "X" ? 0 : P === "Y" ? 1 : 2;
        v = bases[s * n + q] === want ? v * 3 * (bits[s * n + q] ? -1 : 1) : 0;
      }
      vals.push(v);
    }
    return vals;
  };
  const stats = (vals: number[], groups: number) => {
    const size = Math.max(1, Math.floor(vals.length / groups));
    const means: number[] = [];
    for (let g = 0; g + size <= vals.length; g += size) means.push(vals.slice(g, g + size).reduce((a, b) => a + b, 0) / size);
    means.sort((a, b) => a - b);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length - 1));
    return { median: means[means.length >> 1], mean, stderr: sd / Math.sqrt(vals.length) };
  };
  const estimate = (pauli: string, groups = 10) => stats(values(pauli), groups);
  /**
   * QC-1 fix (docs/quantiom-bugs.md #42): a Pauli sum's standard error from its
   * per-snapshot values Σ hₖ vₖ(s). Every term uses the same snapshots, so
   * adding the terms' variances ignored their covariance (X + X read ± 0.045,
   * 2X ± 0.063; X − X read ± 0.045 for a value that is exactly 0 on every snapshot).
   */
  const estimateSum = (terms: { coefficient: number; paulis: string }[], groups = 10) => {
    const total = new Array<number>(snapshots).fill(0);
    for (const t of terms) values(t.paulis).forEach((v, s) => (total[s] += t.coefficient * v));
    return stats(total, groups);
  };
  return { snapshots, estimate, estimateSum };
}

// ─── Process tomography ────────────────────────────────────────────────

/**
 * Pauli transfer matrix of the tape's channel (ideal, or noisy under the
 * model) by process tomography: prepare each input |0⟩, |1⟩, |+⟩, |+i⟩ per
 * qubit, run, read every Pauli expectation, and invert linearly. With exact
 * expectation values it is the channel's PTM R_ij = Tr(P_i Λ(P_j))/2ⁿ.
 */
export function processTomography(n: number, tape: Entry[], m: NoiseModel | null, scope: Record<string, number> = {}): number[][] {
  if (n > 2) throw new Error("process tomography here is for up to 2 qubits");
  const d = 1 << n, K = 4 ** n;
  // Input states: product of {|0⟩, |1⟩, |+⟩, |+i⟩} per qubit (big-endian digits).
  const prep: string[][] = [[], ["x"], ["h"], ["h", "s"]];
  const labels = [..."IXYZ"];
  const pauliOf = (k: number) => Array.from({ length: n }, (_, q) => labels[(k >> (2 * (n - 1 - q))) & 3]).join("");
  // Expectations e[a][i] = Tr(P_i Λ(ρ_a)); the inputs are prepared ideally (the channel is the tape's alone).
  const expectations = Array.from({ length: K }, (_, a) => {
    const inTape: Entry[] = [];
    for (let q = 0; q < n; q++) for (const g of prep[(a >> (2 * (n - 1 - q))) & 3]) inTape.push([step(g, [q])]);
    const psi = new Register(n, inTape.length ? inTape : [[step("i", [0])]]).state;
    // QC-1 fix (docs/quantiom-bugs.md #43): the circuit's symbols take their current values.
    const rho = m ? noisyDensity(n, tape, scope, m, psi).rho : (() => {
      const s = new Register(n, [...inTape, ...tape], scope).state, r = new Float64Array(2 * d * d);
      for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
        r[2 * (i * d + j)] = s[2 * i] * s[2 * j] + s[2 * i + 1] * s[2 * j + 1];
        r[2 * (i * d + j) + 1] = s[2 * i + 1] * s[2 * j] - s[2 * i] * s[2 * j + 1];
      }
      return r;
    })();
    return Array.from({ length: K }, (_, i) => pauliTrace(rho, n, pauliOf(i)));
  });
  // Input Pauli vectors: s[a][j] = Tr(P_j ρ_a) — the same readout of the ideal preparations.
  const inputs = Array.from({ length: K }, (_, a) => {
    const inTape: Entry[] = [];
    for (let q = 0; q < n; q++) for (const g of prep[(a >> (2 * (n - 1 - q))) & 3]) inTape.push([step(g, [q])]);
    const s = new Register(n, inTape.length ? inTape : [[step("i", [0])]]).state, r = new Float64Array(2 * d * d);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
      r[2 * (i * d + j)] = s[2 * i] * s[2 * j] + s[2 * i + 1] * s[2 * j + 1];
      r[2 * (i * d + j) + 1] = s[2 * i + 1] * s[2 * j] - s[2 * i] * s[2 * j + 1];
    }
    return Array.from({ length: K }, (_, j) => pauliTrace(r, n, pauliOf(j)));
  });
  // E = R·S (column a of E is R times column a of S): R = E·S⁻¹, with E, S as K×K (rows i/j, columns a).
  const E = Array.from({ length: K }, (_, i) => Array.from({ length: K }, (_, a) => expectations[a][i]));
  const S = Array.from({ length: K }, (_, j) => Array.from({ length: K }, (_, a) => inputs[a][j]));
  const Sinv = invert(S);
  // (Pauli coordinates s_j = Tr(P_j ρ) map linearly: e = R·s with R_ij = Tr(P_i Λ(P_j))/d.)
  return E.map((row) => Array.from({ length: K }, (_, j) => row.reduce((acc, v, a) => acc + v * Sinv[a][j], 0)));
}

/** Tr(ρ P) for a Pauli string P (big-endian). */
function pauliTrace(rho: Float64Array, n: number, P: string): number {
  const d = 1 << n;
  let tr = 0;
  for (let j = 0; j < d; j++) {
    // P|j⟩ = phase·|k⟩
    let k = j, re = 1, im = 0;
    for (let q = 0; q < n; q++) {
      const bit = (j >> (n - 1 - q)) & 1, c = P[q];
      if (c === "X" || c === "Y") k ^= 1 << (n - 1 - q);
      if (c === "Y") { const [a, b] = bit ? [im, -re] : [-im, re]; re = a; im = b; }
      if (c === "Z" && bit) { re = -re; im = -im; }
    }
    // Tr(ρP) = Σ_j ⟨j|ρ P|j⟩ = Σ_j ρ_{j k} · phase
    const [rr, ri] = [rho[2 * (j * d + k)], rho[2 * (j * d + k) + 1]];
    tr += rr * re - ri * im;
  }
  return tr;
}

function invert(M: number[][]): number[][] {
  const n = M.length, A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const v = A[c][c];
    for (let j = 0; j < 2 * n; j++) A[c][j] /= v;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map((r) => r.slice(n));
}
