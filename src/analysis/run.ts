/**
 * Compute side of the LAB: analysis id → result. Loaded only by the analysis
 * worker (and by InlineEngine in tests). Every numeric routine here is a
 * ported module validated against Qiskit/numpy (test/validated/*).
 */
import type { AnalysisContext, AnalysisResult, Chart, Opts } from "./types";
import { ANALYSIS_BY_ID, defaultCut } from "./catalog";
import { topK, bloch } from "../calc/analysis";
import { reducedDensityMatrix, purity } from "../sim/density";
import {
  entanglementSpectrum, entropyProfile, mutualInformationMatrix, vonNeumannEntropy,
} from "../sim/entanglement";
import { negativityMatrix } from "../sim/negativity";
import { concurrenceMatrix } from "../sim/concurrence";
import { pageCurve } from "../sim/pageCurve";
import { renyiSpectrum } from "../sim/renyiSpectrum";
import { qSphere, type Amplitude } from "../sim/qsphere";

const ROWS = 64;
const ket = (i: number, n: number) => `|${i.toString(2).padStart(n, "0")}⟩`;
const qlabels = (n: number) => [...Array(n).keys()].map((q) => `q${q}`);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** A cut option: a qubit list inside 0..n-1, else the default (first half). */
function cutOf(opts: Opts, key: string, n: number, fallback: number[]): number[] {
  const v = opts[key];
  if (Array.isArray(v)) {
    const q = [...new Set(v.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < n))].sort((a, b) => a - b);
    if (q.length > 0) return q;
  }
  return fallback;
}

function amplitudeRows(ctx: AnalysisContext): number[] {
  const { idx, nonzero } = topK(ctx.state, ROWS);
  return nonzero <= ROWS ? [...idx].sort((a, b) => a - b) : idx;
}

type Run = (ctx: AnalysisContext, opts: Opts) => AnalysisResult;

const RUNS: Record<string, Run> = {
  statevector(ctx) {
    const { n, state } = ctx;
    const rows = amplitudeRows(ctx).map((i) => {
      const re = state[2 * i], im = state[2 * i + 1];
      return [ket(i, n), r3(re), r3(im), r3(Math.hypot(re, im)), `${Math.round((Math.atan2(im, re) * 180) / Math.PI)}°`, r3(re * re + im * im)];
    });
    return { charts: [{ kind: "table", headers: ["basis", "re", "im", "|a|", "arg", "P"], rows }] };
  },

  ampphase(ctx) {
    const { n, state } = ctx;
    const idx = amplitudeRows(ctx);
    return {
      charts: [{
        kind: "bars",
        labels: idx.map((i) => ket(i, n)),
        values: idx.map((i) => Math.hypot(state[2 * i], state[2 * i + 1])),
        phases: idx.map((i) => Math.atan2(state[2 * i + 1], state[2 * i])),
        max: 1,
      }],
    };
  },

  phasedisk(ctx) {
    const { n, state } = ctx;
    // ρ₁₀ = (x + i y)/2 from the (validated) Bloch vector: its angle is the
    // relative phase φ of α|0⟩ + β e^{iφ}|1⟩, so |+i⟩ points along +Im.
    const disks = [...Array(n).keys()].map((q) => {
      const b = bloch(state, n, q);
      return { label: `q${q}`, re: b.x / 2, im: b.y / 2 };
    });
    return { charts: [{ kind: "disks", disks }] };
  },

  qsphere(ctx) {
    const { n, state } = ctx;
    const amps: Amplitude[] = [];
    for (let i = 0; i < 1 << n; i++) {
      amps.push({ basis: i.toString(2).padStart(n, "0"), index: i, re: state[2 * i], im: state[2 * i + 1] });
    }
    const res = qSphere(amps, n)!;
    const points = res.points
      .filter((p) => p.mag > 1e-6)
      .map((p) => ({ label: `|${p.basis}⟩`, x: p.x, y: p.y, z: p.z, mag: p.mag, phase: p.phase }));
    return { charts: [{ kind: "qsphere", points }] };
  },

  density(ctx, opts) {
    const { n, state } = ctx;
    const kept = cutOf(opts, "kept", n, [0]).slice(0, 4);
    const rho = reducedDensityMatrix(state, n, kept);
    const labels = [...Array(1 << kept.length).keys()].map((i) => i.toString(2).padStart(kept.length, "0"));
    return {
      scalars: [
        { label: "kept", value: kept.map((q) => `q${q}`).join(" ") },
        { label: "purity Tr ρ²", value: r3(purity(rho)) },
        { label: "entropy S(ρ)", value: r3(vonNeumannEntropy(rho)), unit: "bits" },
      ],
      charts: [{
        kind: "heatmap", scale: "complex", rows: labels, cols: labels,
        values: rho.map((r) => r.map((e) => e.re)), imag: rho.map((r) => r.map((e) => e.im)),
      }],
    };
  },

  mutualinfo(ctx) {
    const { n, state } = ctx;
    const res = mutualInformationMatrix(state, n)!;
    return {
      scalars: [{ label: "max I(i:j)", value: r3(Math.max(0, ...res.mi.flat())), unit: "bits" }],
      charts: [
        { kind: "heatmap", scale: "seq", min: 0, max: 2, unit: "bits", rows: qlabels(n), cols: qlabels(n), values: res.mi, title: "I(i:j)" },
        { kind: "bars", title: "S(qᵢ): entanglement with the rest", labels: qlabels(n), values: res.single, unit: "bits", max: 1 },
      ],
    };
  },

  negativity(ctx) {
    const { n, state } = ctx;
    const res = negativityMatrix(state, n)!;
    return {
      scalars: [{ label: "max E_N", value: r3(res.maxNeg), unit: "ebits" }],
      charts: [{ kind: "heatmap", scale: "seq", min: 0, max: 1, unit: "ebits", rows: qlabels(n), cols: qlabels(n), values: res.neg, title: "E_N(i,j)" }],
    };
  },

  concurrence(ctx) {
    const { n, state } = ctx;
    const res = concurrenceMatrix(state, n)!;
    return {
      scalars: [{ label: "max C", value: r3(res.max) }],
      charts: [{ kind: "heatmap", scale: "seq", min: 0, max: 1, rows: qlabels(n), cols: qlabels(n), values: res.c, title: "C(i,j)" }],
    };
  },

  schmidt(ctx, opts) {
    const { n, state } = ctx;
    const A = cutOf(opts, "cut", n, defaultCut(n)).slice(0, n - 1);
    const res = entanglementSpectrum(state, n, A);
    if (!res) return { error: "cut too large: keep the smaller side ≤ 6 qubits" };
    const spec = res.spectrum.filter((p) => p > 1e-9);
    return {
      scalars: [
        { label: "A", value: A.map((q) => `q${q}`).join(" ") },
        { label: "entropy S(A)", value: r3(res.entropy), unit: "bits" },
        { label: "Schmidt rank", value: res.rank },
      ],
      charts: [{ kind: "bars", title: "λᵢ (squared Schmidt coefficients)", labels: spec.map((_, i) => `λ${i + 1}`), values: spec, max: 1 }],
    };
  },

  profile(ctx) {
    const { n, state } = ctx;
    const res = entropyProfile(state, n)!;
    const x = res.entropy.map((_, k) => k);
    return {
      charts: [{
        kind: "lines", xLabel: "cut after qubit", yLabel: "S (bits)", x, xTicks: x.map((k) => `${k}|${k + 1}`),
        series: [{ name: "S(A)", y: res.entropy }, { name: "max", y: res.maxEntropy, dashed: true }], yMin: 0,
      }],
    };
  },

  page(ctx) {
    const { n, state } = ctx;
    const res = pageCurve(state, n)!;
    const x = res.entropy.map((_, k) => k);
    return {
      charts: [{
        kind: "lines", xLabel: "cut after qubit", yLabel: "S (bits)", x, xTicks: x.map((k) => `${k}|${k + 1}`),
        series: [
          { name: "state", y: res.entropy },
          { name: "Page (Haar avg)", y: res.page, dashed: true },
          { name: "max", y: res.maxEntropy, dashed: true },
        ],
        yMin: 0,
      }],
    };
  },

  renyi(ctx, opts) {
    const { n, state } = ctx;
    const A = cutOf(opts, "cut", n, defaultCut(n)).slice(0, n - 1);
    const res = renyiSpectrum(state, n, A);
    if (!res) return { error: "cut too large: keep the smaller side ≤ 6 qubits" };
    return {
      scalars: [
        { label: "A", value: A.map((q) => `q${q}`).join(" ") },
        { label: "S₀ (log rank)", value: r3(res.hartley), unit: "bits" },
        { label: "S₁ (von Neumann)", value: r3(res.vonNeumann), unit: "bits" },
        { label: "S∞ (min-entropy)", value: r3(res.min), unit: "bits" },
      ],
      charts: [{ kind: "lines", xLabel: "α", yLabel: "S_α (bits)", x: res.alphas, series: [{ name: "S_α", y: res.entropies }], yMin: 0 }],
    };
  },
};

export function runAnalysis(id: string, ctx: AnalysisContext, opts: Opts): AnalysisResult {
  const meta = ANALYSIS_BY_ID[id];
  const run = RUNS[id];
  if (!meta || !run) return { error: `unknown analysis ${id}` };
  if (ctx.n > meta.maxQubits) return { error: `needs n ≤ ${meta.maxQubits} (n = ${ctx.n})` };
  if (meta.minQubits && ctx.n < meta.minQubits) return { error: `needs n ≥ ${meta.minQubits}` };
  try {
    return run(ctx, opts);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** For tests: every catalog id must have a compute function. */
export const RUN_IDS = Object.keys(RUNS);
export type { Chart };
