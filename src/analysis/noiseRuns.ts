/**
 * LAB "Noise & error": analyses of the tape under the noise model, and the
 * noisy PROB / BLOCH / SHOTS views. Every quantity is computed from the
 * density matrix (exact, unitary tapes up to 10 qubits) or trajectories;
 * the noise core is validated against qiskit-aer (fixture `noise`), the
 * derived quantities against Qiskit/numpy (fixture `noise-analyses`).
 */
import type { AnalysisContext, AnalysisResult, Opts } from "./types";
import { ANALYSIS_BY_ID, defaultCut, inputValue, pauliValue } from "./catalog";
import type { ViewData } from "../calc/core";
import { topK } from "../calc/analysis";
import { Register } from "../calc/register";
import { densityOk, noisyDensity, noisyShots, noisyStats, runTrajectories, DENSITY_MAX } from "../noise/sim";
import { isIdeal, rate, type NoiseModel } from "../noise/model";
import { noisyExpectation, pec, zne, type ZneFit } from "../noise/mitigation";
import { hermitianEig } from "../sim/eig";
import { parsePauliSum } from "../sim/trotter";
import { pauliSumExpectation } from "../sim/expectation";
import type { Complex } from "../sim/density";

type Run = (ctx: AnalysisContext, opts: Opts) => AnalysisResult;
const num = (id: string, key: string, opts: Opts, n: number) => inputValue(ANALYSIS_BY_ID[id].inputs.find((s) => s.key === key)!, opts, n);
const r4 = (x: number) => x; // full precision: the UI formats numbers
const ket = (i: number, n: number) => `|${i.toString(2).padStart(n, "0")}⟩`;

function model(ctx: AnalysisContext): NoiseModel {
  if (!ctx.noise || !ctx.noise.enabled) throw new Error("noise is off: turn it on in LAB → Noise & error → Noise model");
  return ctx.noise;
}

// ─── Density-matrix helpers ────────────────────────────────────────────

/** ρ of the noisy tape: exact when possible, else a trajectory estimate (small n). */
function densityOf(ctx: AnalysisContext, m: NoiseModel): { rho: Float64Array; method: string } {
  if (densityOk(ctx.n, ctx.tape)) return { rho: noisyDensity(ctx.n, ctx.tape, ctx.scope, m).rho, method: "exact density matrix" };
  if (ctx.n > 8) throw new Error(`needs a unitary tape up to ${DENSITY_MAX} qubits, or n ≤ 8 for a trajectory estimate`);
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
  return { rho, method: `${T} trajectories (the tape measures, resets or uses IF)` };
}

const toComplex = (rho: Float64Array, d: number): Complex[][] =>
  Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => ({ re: rho[2 * (i * d + j)], im: rho[2 * (i * d + j) + 1] })));

function eigenvalues(rho: Float64Array, d: number): number[] {
  return hermitianEig(toComplex(rho, d)).values.map((v) => Math.max(0, v)).sort((a, b) => b - a);
}

const entropyOf = (ev: number[]) => -ev.filter((p) => p > 1e-15).reduce((a, p) => a + p * Math.log2(p), 0);

/** Partial trace keeping `keep` (sorted), big-endian. */
export function partialTrace(rho: Float64Array, n: number, keep: number[]): Float64Array {
  const d = 1 << n, k = keep.length, dk = 1 << k;
  const out = new Float64Array(2 * dk * dk);
  const sub = (i: number) => keep.reduce((a, q, t) => a | (((i >> (n - 1 - q)) & 1) << (k - 1 - t)), 0);
  const rest = (i: number) => i & ~keep.reduce((a, q) => a | (1 << (n - 1 - q)), 0);
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

const KET_ROWS = 32;

export function noisyView(ctx: AnalysisContext, opts: Opts): AnalysisResult {
  const m = model(ctx);
  const n = ctx.n, mode = opts.mode as "prob" | "bloch" | "shots";
  const stats = noisyStats(n, ctx.tape, ctx.scope, m);
  const method = stats.method === "density" ? "ρ" : `${stats.trajectories} trajectories`;
  let view: ViewData;
  if (mode === "bloch") view = { n, mode: "bloch", vectors: stats.bloch };
  else if (mode === "shots") {
    const shots = Number(opts.shots) || 1024;
    const counts = noisyShots(n, stats.probs, m, shots, 0x5407 + (Number(opts.seed) || 0));
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    view = { n, mode: "shots", shots, distinct: rows.length, rows: rows.slice(0, KET_ROWS).map(([i, count]) => ({ i, count })) };
  } else {
    const st = new Float64Array(2 * stats.probs.length);
    stats.probs.forEach((p, i) => (st[2 * i] = Math.sqrt(p)));
    const rows = n <= 4 ? [...Array(1 << n).keys()] : topK(st, KET_ROWS).idx;
    view = { n, mode: "prob", complete: n <= 4, rows: rows.map((i) => ({ i, p: stats.probs[i] })) };
  }
  return { view: { ...view, method } };
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
  return { depol: { x: p1 / 4, y: p1 / 4, z: p1 / 4 }, amp: A, phase: P, readout: rate(m, "readout", q) };
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
    const psi = idealState(ctx);
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
      notes: [noteMethod(method), "ψ is the ideal (noiseless) state of the tape."],
    };
  },

  decoherence(ctx) {
    const m = model(ctx);
    if (!densityOk(ctx.n, ctx.tape) || ctx.n > 6) throw new Error("needs a unitary tape up to 6 qubits");
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
    const shown = ev.slice(0, 16);
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
    // The same for the ideal state, for comparison.
    const psi = idealState(ctx);
    let l1i = 0, Si = 0;
    const amp = Array.from({ length: d }, (_, i) => Math.hypot(psi[2 * i], psi[2 * i + 1]));
    const sum = amp.reduce((a, b) => a + b, 0);
    l1i = sum * sum - amp.reduce((a, b) => a + b * b, 0);
    Si = entropyOf(amp.map((a) => a * a));
    return {
      scalars: [
        { label: "l1 coherence (noisy)", value: r4(l1) },
        { label: "l1 coherence (ideal)", value: r4(l1i) },
        { label: "relative-entropy coherence (noisy)", value: r4(Sdiag - S), unit: "bits" },
        { label: "relative-entropy coherence (ideal)", value: r4(Si), unit: "bits" },
      ],
      notes: [noteMethod(method), "Computational-basis coherence (Baumgratz, Cramer & Plenio 2014): l1 = Σ_{i≠j}|ρ_ij|, C_rel = S(diag ρ) − S(ρ)."],
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
    const flip = (dist: Float64Array, inverse: boolean) => {
      let out = Float64Array.from(dist);
      for (let q = 0; q < n; q++) {
        const p = rate(m, "readout", q), mask = 1 << (n - 1 - q);
        const [a, b] = inverse ? [(1 - p) / (1 - 2 * p), -p / (1 - 2 * p)] : [1 - p, p];
        const next = new Float64Array(d);
        for (let i = 0; i < d; i++) next[i] = a * out[i] + b * out[i ^ mask];
        out = next;
      }
      return out;
    };
    if ([...Array(n).keys()].some((q) => rate(m, "readout", q) >= 0.5)) throw new Error("readout error ≥ 0.5 can't be inverted");
    const measured = flip(stats.probs, false);
    const mitigated = flip(measured, true);
    const clipped = mitigated.map((x) => Math.max(0, x));
    const z = clipped.reduce((a, b) => a + b, 0);
    const top = [...Array(d).keys()].sort((a, b) => stats.probs[b] - stats.probs[a]).slice(0, 8);
    return {
      charts: [{
        kind: "table", title: "probabilities", headers: ["", "state (no readout)", "measured", "mitigated"],
        rows: top.map((i) => [ket(i, n), r4(stats.probs[i]), r4(measured[i]), r4(clipped[i] / z)]),
      }],
      notes: [
        "Readout error as a confusion matrix A = ⊗ A_q, A_q = [[1−p, p], [p, 1−p]]; mitigation applies A⁻¹, clips negatives and renormalises.",
        noteMethod(stats.method === "density" ? "exact density matrix" : `${stats.trajectories} trajectories`),
      ],
    };
  },

  mitigated(ctx, opts) {
    const m = model(ctx);
    const n = ctx.n;
    const terms = parsePauliSum(pauliValue(opts, "obs", n));
    if (terms[0].paulis.length !== n) throw new Error(`Pauli strings need ${n} letters`);
    const how = num("mitigated", "method", opts, n);
    const unitary = !ctx.tape.some((e) => e.some((s) => s.condition || ["measure", "measure_x", "measure_y", "reset"].includes(s.gateId) || s.gateId.startsWith("init")));
    const ideal = unitary ? pauliSumExpectation(idealState(ctx), n, terms) : NaN;
    const noisy = noisyExpectation(n, ctx.tape, ctx.scope, m, terms);
    const scalars: AnalysisResult["scalars"] = [
      { label: "ideal ⟨H⟩", value: unitary ? r4(ideal) : "— (the tape measures)" },
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
      if (!unitary) throw new Error("PEC here needs a unitary tape");
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
