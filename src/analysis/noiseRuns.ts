/**
 * LAB "Noise & error": analyses of the tape under the noise model, and the
 * noisy PROB / BLOCH / SHOTS views. Every quantity is computed from the
 * density matrix (exact, unitary tapes up to 10 qubits) or trajectories;
 * the noise core is validated against qiskit-aer (fixture `noise`), the
 * derived quantities against Qiskit/numpy (fixture `noise-analyses`).
 */
import type { AnalysisContext, AnalysisResult, Opts } from "./types";
import { ANALYSIS_BY_ID, defaultCut, inputValue, pauliInput } from "./catalog";
import { KET_ROWS, SHOT_ROWS, type ViewData } from "../calc/core";
import { topK } from "../calc/analysis";
import { estimateView, stateTomography } from "../calc/estimate";
import { leadingState, TOMO_MAX } from "../calc/tomography";
import { confusion } from "../calc/tomography";
import { viewProvenance } from "../calc/provenance";
import { Register } from "../calc/register";
import { densityOk, measurementDevice, noisyDensity, noisyShots, noisyStats, runTrajectories, DENSITY_MAX } from "../noise/sim";
import { noisyStatsParallel } from "../noise/parallel";
import { isIdeal, rate, readoutPair, type NoiseModel } from "../noise/model";
import { noisyExpectation, pec, zne, type ZneFit } from "../noise/mitigation";
import { hermitianEig } from "../sim/eig";
import { parsePauliSum } from "../sim/trotter";
import { pauliSumExpectation } from "../sim/expectation";
import type { Complex } from "../sim/density";

type Run = (ctx: AnalysisContext, opts: Opts) => AnalysisResult | Promise<AnalysisResult>;
const num = (id: string, key: string, opts: Opts, n: number) => inputValue(ANALYSIS_BY_ID[id].inputs.find((s) => s.key === key)!, opts, n);
const r4 = (x: number) => x; // full precision: the UI formats numbers
const ket = (i: number, n: number) => `|${i.toString(2).padStart(n, "0")}⟩`;

function model(ctx: AnalysisContext): NoiseModel {
  if (!ctx.noise || !ctx.noise.enabled) throw new Error("noise is off: turn it on in LAB → Noise & error → Noise model");
  return ctx.noise;
}

// ─── Density-matrix helpers ────────────────────────────────────────────

/** ρ of the noisy tape: exact when possible, else a trajectory estimate (small n). */
export function densityOf(ctx: AnalysisContext, m: NoiseModel): { rho: Float64Array; method: string } {
  if (densityOk(ctx.n, ctx.tape)) return { rho: noisyDensity(ctx.n, ctx.tape, ctx.scope, m).rho, method: "exact density matrix" };
  if (ctx.n > 8) throw new Error(`needs a unitary circuit up to ${DENSITY_MAX} qubits, or n ≤ 8 for a trajectory estimate`);
  return { rho: trajectoryDensity(ctx, m), method: `${m.trajectories} trajectories (the circuit measures, resets or uses IF)` };
}

/** ρ averaged over trajectories: the unconditional ensemble (every measurement outcome, with its probability). */
function trajectoryDensity(ctx: AnalysisContext, m: NoiseModel): Float64Array {
  const d = 1 << ctx.n, rho = new Float64Array(2 * d * d);
  let T = 0;
  runTrajectories(ctx.n, ctx.tape, ctx.scope, m, (st) => {
    T++;
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
      rho[2 * (i * d + j)] += st[2 * i] * st[2 * j] + st[2 * i + 1] * st[2 * j + 1];
      rho[2 * (i * d + j) + 1] += st[2 * i + 1] * st[2 * j] - st[2 * i] * st[2 * j + 1];
    }
  });
  for (let i = 0; i < rho.length; i++) rho[i] /= T;
  return rho;
}

/**
 * QC-1 fix (docs/quantiom-bugs.md #44): the ideal reference conditioned like
 * the noisy state. For a unitary circuit that is |ψ⟩⟨ψ|. With measurements the
 * noisy ρ averages every outcome, so the reference is the noiseless
 * unconditional ensemble too: the same trajectories with every rate at zero
 * (same random stream, so the sampling noise largely cancels in comparisons).
 * Comparing the ensemble with the recorded branch gave fidelity ½ at zero noise.
 */
function idealReference(ctx: AnalysisContext, m: NoiseModel): { pure: Float64Array } | { mixed: Float64Array } {
  if (densityOk(ctx.n, ctx.tape)) return { pure: idealState(ctx) };
  const zero: NoiseModel = { ...m, p1: 0, p2: 0, ad: 0, pd: 0, readout: 0, readout10: undefined, crosstalk: 0, perQubit: undefined, perGate: undefined };
  return { mixed: trajectoryDensity(ctx, zero) };
}
const UNCONDITIONAL = "The circuit measures: both states are the unconditional ensemble over measurement outcomes (each branch with its probability), not the recorded outcomes.";

/** Uhlmann fidelity (Tr √(√σ ρ √σ))² of two density matrices. */
function uhlmann(sigma: Float64Array, rho: Float64Array, d: number): number {
  const e = hermitianEig(toComplex(sigma, d));
  // √σ = V diag(√λ) V†
  const sq: Complex[][] = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => {
    let re = 0, im = 0;
    e.values.forEach((l, k) => {
      const w = Math.sqrt(Math.max(0, l)), a = e.vectors[k][i], b = e.vectors[k][j]; // a · conj(b)
      re += w * (a.re * b.re + a.im * b.im); im += w * (a.im * b.re - a.re * b.im);
    });
    return { re, im };
  }));
  const R = toComplex(rho, d);
  const mul = (A: Complex[][], B: Complex[][]) => A.map((row) => B[0].map((_, j) => row.reduce((acc, z, k) => ({ re: acc.re + z.re * B[k][j].re - z.im * B[k][j].im, im: acc.im + z.re * B[k][j].im + z.im * B[k][j].re }), { re: 0, im: 0 })));
  const M = mul(mul(sq, R), sq);
  const t = hermitianEig(M).values.reduce((a, v) => a + Math.sqrt(Math.max(0, v)), 0);
  return t * t;
}

const toComplex = (rho: Float64Array, d: number): Complex[][] =>
  Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => ({ re: rho[2 * (i * d + j)], im: rho[2 * (i * d + j) + 1] })));

function eigenvalues(rho: Float64Array, d: number): number[] {
  return hermitianEig(toComplex(rho, d)).values.map((v) => Math.max(0, v)).sort((a, b) => b - a);
}

const entropyOf = (ev: number[]) => -ev.filter((p) => p > 1e-15).reduce((a, p) => a + p * Math.log2(p), 0);

/** Partial trace keeping `keep` (sorted): qubit q is bit q, keep[t] is bit t of ρ (Qiskit's order). */
export function partialTrace(rho: Float64Array, n: number, keep: number[]): Float64Array {
  const d = 1 << n, k = keep.length, dk = 1 << k;
  const out = new Float64Array(2 * dk * dk);
  const sub = (i: number) => keep.reduce((a, q, t) => a | (((i >> q) & 1) << t), 0);
  const rest = (i: number) => i & ~keep.reduce((a, q) => a | (1 << q), 0);
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    if (rest(i) !== rest(j)) continue;
    const a = sub(i), b = sub(j);
    out[2 * (a * dk + b)] += rho[2 * (i * d + j)];
    out[2 * (a * dk + b) + 1] += rho[2 * (i * d + j) + 1];
  }
  return out;
}

function idealState(ctx: AnalysisContext): Float64Array {
  // The ideal register's state (recorded outcomes) — for fidelity comparisons on unitary tapes.
  return new Register(ctx.n, ctx.tape, ctx.scope).state;
}

const noteMethod = (method: string) => `Noisy state: ${method}.`;

// ─── Views ─────────────────────────────────────────────────────────────



export async function noisyView(ctx: AnalysisContext, opts: Opts): Promise<AnalysisResult> {
  const m = model(ctx);
  const n = ctx.n, mode = opts.mode as "ket" | "prob" | "bloch" | "shots";
  // Scrubbed (CIRC): the circuit up to that step.
  const tape = typeof opts.upTo === "number" ? ctx.tape.slice(0, opts.upTo) : ctx.tape;
  if (mode === "ket") {
    if (n > (opts.estimate ? TOMO_MAX : 8)) return { error: opts.estimate ? `Density-matrix tomography supports up to ${TOMO_MAX} qubits. Use local density analyses in LAB for larger circuits.` : "Full noisy STATE supports up to 8 qubits. Use PROB, BLOCH, or local tomography in LAB for larger circuits." };
    const source = densityOf({ ...ctx, tape }, m);
    const shots = Number(opts.shots) || 1024;
    const tomo = opts.estimate ? stateTomography(n, shots, Number(opts.seed) || 0, { rho: source.rho }, measurementDevice(m, n), undefined, !!opts.mitigate) : null;
    const rho = tomo?.rho ?? source.rho, d = 2 ** n;
    const purity = rho.reduce((sum, x) => sum + x * x, 0);
    const eig = n <= 6 ? hermitianEig(toComplex(rho, d)) : null;
    const weight = eig?.values[d - 1];
    const state = eig ? leadingState(eig.vectors[d - 1]) : null;
    const rows = state ? Array.from({ length: d }, (_, i) => ({ i, re: state[2 * i], im: state[2 * i + 1] })).filter(r => Math.hypot(r.re, r.im) > 1e-10) : [];
    return { view: { mode: "ket", method: source.method, n, rows, nonzero: rows.length, restP: 0,
      density: { rho, purity, weight, degenerate: !!eig && Math.abs(eig.values[d - 1] - eig.values[d - 2]) < 1e-8 },
      ...(tomo ? { estimate: { shots, settings: tomo.settings, lambda: tomo.lambda } } : {}),
      provenance: { method: tomo ? "Density-matrix tomography" : "Mixed-state simulation", detail: `${source.method}${tomo ? ` · ${tomo.settings} settings × ${shots.toLocaleString()} shots${opts.mitigate ? " · readout mitigated" : ""}` : " · before readout"}` },
    } };
  }
  const stats = await noisyStatsParallel(n, tape, ctx.scope, m);
  const method = stats.method === "density" ? "ρ" : `${stats.trajectories} trajectories${stats.workers ? ` · ${stats.workers} cores` : ""}`;
  let view: ViewData;
  const shots = Number(opts.shots) || 1024;
  // Periodic runs: STATE/PROB/BLOCH from the same noisy sample as SHOTS (estimate.ts).
  const seed = Number(opts.seed) || 0;
  if (opts.estimate && mode !== "shots") {
    // What the run's experiments give on the noisy circuit: Z (as SHOTS), X and Y, and tomography of the noisy ρ.
    const device = measurementDevice(m, n);
    view = estimateView(mode, n, shots, {
      z: noisyShots(n, stats.probs, m, shots, 0x5407 + seed), device, seed, mitigate: !!opts.mitigate,
      bloch: () => stats.bloch,
      tomography: () => stateTomography(n, shots, seed, { rho: densityOf({ ...ctx, tape }, m).rho }, device, undefined, !!opts.mitigate),
    });
  }
  else if (mode === "bloch") view = { n, mode: "bloch", vectors: stats.bloch };
  else if (mode === "shots") {
    const counts = noisyShots(n, stats.probs, m, shots, 0x5407 + (Number(opts.seed) || 0));
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const listed = rows.slice(0, SHOT_ROWS);
    view = { n, mode: "shots", shots, distinct: rows.length, rows: listed.map(([i, count]) => ({ i, count })), other: shots - listed.reduce((s, [, c]) => s + c, 0) };
  } else {
    const st = new Float64Array(2 * stats.probs.length);
    stats.probs.forEach((p, i) => (st[2 * i] = Math.sqrt(p)));
    const { idx, nonzero } = topK(st, KET_ROWS);
    const rows = n <= 4 ? [...Array(1 << n).keys()] : idx;
    const listed = rows.reduce((s, i) => s + stats.probs[i], 0);
    view = { n, mode: "prob", complete: n <= 4 || nonzero <= KET_ROWS, restP: Math.max(0, 1 - listed), rows: rows.map((i) => ({ i, p: stats.probs[i] })) };
  }
  const source = stats.method === "density" ? "Exact density-matrix simulation" : "Trajectory approximation";
  const detail = [stats.method === "density" ? "Noise model included" : `${stats.trajectories.toLocaleString()} noise trajectories`, opts.mitigate && opts.estimate ? "readout mitigated; approximate error propagation" : ""].filter(Boolean).join(" · ");
  return { view: { ...view, method, provenance: viewProvenance(view, source, detail) } };
}

// ─── Analyses ──────────────────────────────────────────────────────────

/** Pauli-twirled error per gate on qubit q (X, Y, Z probabilities) from depolarizing, amplitude and phase damping. */
export function pauliBudget(m: NoiseModel, q: number) {
  const p1 = rate(m, "p1", q), ad = rate(m, "ad", q), pd = rate(m, "pd", q);
  // Depolarizing λ: X, Y, Z each λ/4. Damping: from the PTM diagonal (R_xx, R_yy, R_zz):
  // p_X = (1 + R_xx − R_yy − R_zz)/4 and cyclic.
  const twirl = (rxx: number, ryy: number, rzz: number) => ({
    x: (1 + rxx - ryy - rzz) / 4, y: (1 - rxx + ryy - rzz) / 4, z: (1 - rxx - ryy + rzz) / 4,
  });
  const A = twirl(Math.sqrt(1 - ad), Math.sqrt(1 - ad), 1 - ad);
  const P = twirl(Math.sqrt(1 - pd), Math.sqrt(1 - pd), 1);
  const [r01, r10] = readoutPair(m, q);
  return { depol: { x: p1 / 4, y: p1 / 4, z: p1 / 4 }, amp: A, phase: P, readout: r01 === r10 ? r01 : `${r01} / ${r10}` };
}

export const NOISE_RUNS: Record<string, Run> = {
  noisemodel(ctx) {
    const m = ctx.noise;
    return { scalars: [{ label: "noise", value: m?.enabled && !isIdeal(m) ? "on" : "off" }] };
  },

  impact(ctx) {
    const m = model(ctx);
    const d = 1 << ctx.n;
    const { rho, method } = densityOf(ctx, m);
    const ref = idealReference(ctx, m);
    if ("mixed" in ref) {
      const sigma = ref.mixed, diff = new Float64Array(rho);
      for (let i = 0; i < diff.length; i++) diff[i] -= sigma[i];
      const ev = eigenvalues(rho, d);
      return {
        scalars: [
          { label: "fidelity F(σ, ρ)", value: r4(Math.min(1, uhlmann(sigma, rho, d))) },
          { label: "trace distance", value: r4(hermitianEig(toComplex(diff, d)).values.reduce((a, v) => a + Math.abs(v), 0) / 2) },
          { label: "purity Tr ρ²", value: r4(ev.reduce((a, p) => a + p * p, 0)) },
          { label: "entropy S(ρ)", value: r4(entropyOf(ev)), unit: "bits" },
        ],
        notes: [noteMethod(method), UNCONDITIONAL, "σ is the noiseless ensemble; F is the Uhlmann fidelity."],
      };
    }
    const psi = ref.pure;
    // F = ⟨ψ|ρ|ψ⟩
    let F = 0;
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
      const [ar, ai, br, bi] = [psi[2 * i], psi[2 * i + 1], psi[2 * j], psi[2 * j + 1]];
      const [rr, ri] = [rho[2 * (i * d + j)], rho[2 * (i * d + j) + 1]];
      // conj(ψ_i) ρ_ij ψ_j
      const xr = ar * rr + ai * ri, xi = ar * ri - ai * rr;
      F += xr * br - xi * bi;
    }
    const ev = eigenvalues(rho, d);
    // Trace distance ½‖ρ − |ψ⟩⟨ψ|‖₁ from the eigenvalues of the difference.
    const diff = new Float64Array(rho);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
      diff[2 * (i * d + j)] -= psi[2 * i] * psi[2 * j] + psi[2 * i + 1] * psi[2 * j + 1];
      diff[2 * (i * d + j) + 1] -= psi[2 * i + 1] * psi[2 * j] - psi[2 * i] * psi[2 * j + 1];
    }
    const td = hermitianEig(toComplex(diff, d)).values.reduce((a, v) => a + Math.abs(v), 0) / 2;
    const purity = ev.reduce((a, p) => a + p * p, 0);
    return {
      scalars: [
        { label: "fidelity ⟨ψ|ρ|ψ⟩", value: r4(F) },
        { label: "trace distance", value: r4(td) },
        { label: "purity Tr ρ²", value: r4(purity) },
        { label: "entropy S(ρ)", value: r4(entropyOf(ev)), unit: "bits" },
      ],
      notes: [noteMethod(method), "ψ is the ideal (noiseless) state of the circuit."],
    };
  },

  decoherence(ctx) {
    const m = model(ctx);
    if (!densityOk(ctx.n, ctx.tape) || ctx.n > 6) throw new Error("needs a unitary circuit up to 6 qubits");
    const k = Math.min(ctx.tape.length, 64);
    const d = 1 << ctx.n;
    const fid: number[] = [], pur: number[] = [];
    for (let s = 1; s <= k; s++) {
      const prefix = ctx.tape.slice(0, s);
      const { rho } = noisyDensity(ctx.n, prefix, ctx.scope, m);
      const psi = new Register(ctx.n, prefix, ctx.scope).state;
      let F = 0, P = 0;
      for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
        const [rr, ri] = [rho[2 * (i * d + j)], rho[2 * (i * d + j) + 1]];
        P += rr * rr + ri * ri;
        const [ar, ai, br, bi] = [psi[2 * i], psi[2 * i + 1], psi[2 * j], psi[2 * j + 1]];
        const xr = ar * rr + ai * ri, xi = ar * ri - ai * rr;
        F += xr * br - xi * bi;
      }
      fid.push(F);
      pur.push(P);
    }
    return {
      scalars: [{ label: "fidelity at the end", value: r4(fid[fid.length - 1] ?? 1) }],
      charts: [{
        kind: "lines", x: fid.map((_, i) => i + 1), xLabel: "step", yLabel: "", yMin: 0, yMax: 1,
        series: [{ name: "fidelity to ideal", y: fid }, { name: "purity", y: pur, dashed: true }],
      }],
      notes: ["Exact density matrix after each step, against the ideal state after that step."],
    };
  },

  mixedspectrum(ctx) {
    const m = model(ctx);
    const d = 1 << ctx.n;
    const { rho, method } = densityOf(ctx, m);
    const ev = eigenvalues(rho, d);
    const purity = ev.reduce((a, p) => a + p * p, 0);
    const shown = ev.filter((x, i) => i < 64 && x > 1e-12);
    return {
      scalars: [
        { label: "purity", value: r4(purity) },
        { label: "effective rank 1/Σp²", value: r4(1 / purity) },
        { label: "entropy", value: r4(entropyOf(ev)), unit: "bits" },
      ],
      charts: [{ kind: "bars", title: "eigenvalues of ρ (largest first)", labels: shown.map((_, i) => `λ${i + 1}`), values: shown }],
      notes: [noteMethod(method)],
    };
  },

  coherentinfo(ctx, opts) {
    const m = model(ctx);
    const n = ctx.n, d = 1 << n;
    const A = Array.isArray(opts.cut) && (opts.cut as number[]).length ? (opts.cut as number[]).filter((q) => q < n).sort((a, b) => a - b) : defaultCut(n);
    const B = [...Array(n).keys()].filter((q) => !A.includes(q));
    if (!B.length || !A.length) throw new Error("the cut needs qubits on both sides");
    const { rho, method } = densityOf(ctx, m);
    const SB = entropyOf(eigenvalues(partialTrace(rho, n, B), 1 << B.length));
    const SAB = entropyOf(eigenvalues(rho, d));
    const SA = entropyOf(eigenvalues(partialTrace(rho, n, A), 1 << A.length));
    return {
      scalars: [
        { label: "I(A⟩B) = S(B) − S(AB)", value: r4(SB - SAB), unit: "bits" },
        { label: "I(B⟩A) = S(A) − S(AB)", value: r4(SA - SAB), unit: "bits" },
        { label: "S(A), S(B), S(AB)", value: `${r4(SA)}, ${r4(SB)}, ${r4(SAB)}` },
      ],
      notes: [noteMethod(method), "Positive coherent information certifies quantum correlations that survive the noise."],
    };
  },

  noisycoherence(ctx) {
    const m = model(ctx);
    const d = 1 << ctx.n;
    const { rho, method } = densityOf(ctx, m);
    let l1 = 0;
    const diag: number[] = [];
    for (let i = 0; i < d; i++) {
      diag.push(Math.max(0, rho[2 * (i * d + i)]));
      for (let j = 0; j < d; j++) if (i !== j) l1 += Math.hypot(rho[2 * (i * d + j)], rho[2 * (i * d + j) + 1]);
    }
    const Sdiag = entropyOf(diag), S = entropyOf(eigenvalues(rho, d));
    // The same for the ideal reference, conditioned the same way (#44).
    const ref = idealReference(ctx, m);
    let l1i = 0, Si = 0;
    if ("mixed" in ref) {
      const sg = ref.mixed, dg: number[] = [];
      for (let i = 0; i < d; i++) {
        dg.push(Math.max(0, sg[2 * (i * d + i)]));
        for (let j = 0; j < d; j++) if (i !== j) l1i += Math.hypot(sg[2 * (i * d + j)], sg[2 * (i * d + j) + 1]);
      }
      Si = entropyOf(dg) - entropyOf(eigenvalues(sg, d));
    } else {
      const psi = ref.pure;
      const amp = Array.from({ length: d }, (_, i) => Math.hypot(psi[2 * i], psi[2 * i + 1]));
      const sum = amp.reduce((a, b) => a + b, 0);
      l1i = sum * sum - amp.reduce((a, b) => a + b * b, 0);
      Si = entropyOf(amp.map((a) => a * a));
    }
    return {
      scalars: [
        { label: "l1 coherence (noisy)", value: r4(l1) },
        { label: "l1 coherence (ideal)", value: r4(l1i) },
        { label: "relative-entropy coherence (noisy)", value: r4(Sdiag - S), unit: "bits" },
        { label: "relative-entropy coherence (ideal)", value: r4(Si), unit: "bits" },
      ],
      notes: [noteMethod(method), ...("mixed" in ref ? [UNCONDITIONAL] : []), "Computational-basis coherence (Baumgratz, Cramer & Plenio 2014): l1 = Σ_{i≠j}|ρ_ij|, C_rel = S(diag ρ) − S(ρ)."],
    };
  },

  paulibudget(ctx) {
    const m = model(ctx);
    const rows = [...Array(ctx.n).keys()].map((q) => {
      const b = pauliBudget(m, q);
      const x = b.depol.x + b.amp.x + b.phase.x, y = b.depol.y + b.amp.y + b.phase.y, z = b.depol.z + b.amp.z + b.phase.z;
      return [`q${q}`, x, y, z, x + y + z, b.readout];
    });
    return {
      charts: [{ kind: "table", title: "per 1-qubit gate, Pauli-twirled", headers: ["", "p_X", "p_Y", "p_Z", "total", "readout"], rows }],
      notes: [
        "Depolarizing λ gives X, Y, Z each λ/4; damping channels are twirled from their Pauli transfer matrix: p_X = (1 + R_xx − R_yy − R_zz)/4 and cyclic.",
        "Summed over channels (first order); two-qubit depolarizing adds λ₂/16 per two-qubit Pauli.",
      ],
    };
  },

  readout(ctx) {
    const m = model(ctx);
    const n = ctx.n, d = 1 << n;
    const stats = noisyStats(n, ctx.tape, ctx.scope, m);
    // Measured distribution: the readout confusion applied exactly (tensor of per-qubit A_q).
    const readout = Array.from({ length: n }, (_, q) => readoutPair(m, q));
    const measured = confusion(stats.probs, n, readout, false);
    const mitigated = confusion(measured, n, readout, true);
    const clipped = mitigated.map((x) => Math.max(0, x));
    const z = clipped.reduce((a, b) => a + b, 0);
    const top = [...Array(d).keys()].sort((a, b) => stats.probs[b] - stats.probs[a]).slice(0, 32);
    return {
      charts: [{
        kind: "table", title: "probabilities", headers: ["", "state (no readout)", "measured", "mitigated"],
        rows: top.map((i) => [ket(i, n), r4(stats.probs[i]), r4(measured[i]), r4(clipped[i] / z)]),
      }],
      notes: [
        "Readout error as a confusion matrix A = ⊗ A_q, A_q = [[1−p₀₁, p₁₀], [p₀₁, 1−p₁₀]] (p₀₁ = P(read 1 | 0), p₁₀ = P(read 0 | 1)); mitigation applies A⁻¹, clips negatives and renormalises.",
        noteMethod(stats.method === "density" ? "exact density matrix" : `${stats.trajectories} trajectories`),
      ],
    };
  },

  mitigated(ctx, opts) {
    const m = model(ctx);
    const n = ctx.n;
    const terms = parsePauliSum(pauliInput(opts, "obs", n));
    if (terms[0].paulis.length !== n) throw new Error(`Pauli strings need ${n} letters`);
    const how = num("mitigated", "method", opts, n);
    const unitary = !ctx.tape.some((e) => e.some((s) => s.condition || ["measure", "measure_x", "measure_y", "reset"].includes(s.gateId) || s.gateId.startsWith("init")));
    const ideal = unitary ? pauliSumExpectation(idealState(ctx), n, terms) : NaN;
    const noisy = noisyExpectation(n, ctx.tape, ctx.scope, m, terms);
    const scalars: AnalysisResult["scalars"] = [
      { label: "ideal ⟨H⟩", value: unitary ? r4(ideal) : "— (the circuit measures)" },
      { label: "noisy ⟨H⟩", value: noisy.stderr ? `${r4(noisy.value)} ± ${r4(noisy.stderr)}` : r4(noisy.value) },
    ];
    const charts: AnalysisResult["charts"] = [];
    if (how <= 2) {
      const fit: ZneFit = (["linear", "richardson", "exponential"] as const)[how];
      const z = zne(n, ctx.tape, ctx.scope, m, terms, fit);
      scalars.push({ label: `ZNE (${fit})`, value: r4(z.value) });
      charts.push({
        kind: "scatter", x: [0, ...z.samples.map((s) => s.scale)], y: [z.value, ...z.samples.map((s) => s.value)],
        xLabel: "noise scale (0 = extrapolated)", yLabel: "⟨H⟩",
      });
    } else {
      if (!unitary) throw new Error("PEC here needs a unitary circuit");
      const T = num("mitigated", "samples", opts, n);
      const p = pec(n, ctx.tape, ctx.scope, m, terms, { trajectories: T });
      scalars.push({ label: "PEC", value: `${r4(p.value)} ± ${r4(p.stderr)}` }, { label: "sampling overhead Γ", value: r4(p.gamma) });
    }
    return {
      scalars, charts,
      notes: ["ZNE scales every error rate by 1, 2, 3 and extrapolates to 0. PEC inverts each gate's channels quasi-probabilistically: unbiased, with variance growing like Γ²."],
    };
  },
};
