/**
 * Compute side of the LAB: analysis id → result. Loaded only by the analysis
 * worker (and by InlineEngine in tests). Every numeric routine here is a
 * ported module validated against Qiskit/numpy (test/validated/*).
 */
import type { AnalysisContext, AnalysisResult, Chart, Opts } from "./types";
import { ANALYSIS_BY_ID, defaultCut, inputValue } from "./catalog";
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
import { tripartiteInformation } from "../sim/tripartiteInfo";
import { countingStatistics } from "../sim/countingStatistics";
import { entanglementContour } from "../sim/entanglementContour";
import { schmidtGap } from "../sim/schmidtGap";
import { correlationLength } from "../sim/correlationLength";
import { mpsBondDimension } from "../sim/mpsBondDimension";
import { negativitySpectrum } from "../sim/negativitySpectrum";
import { threeTangle } from "../sim/threeTangle";
import { totalCorrelation } from "../sim/totalCorrelation";
import { chshMap } from "../sim/chsh";
import { quantumDiscordMap } from "../sim/quantumDiscord";
import { entanglementSpectrumStats } from "../sim/entanglementSpectrumStats";
import { multifractal } from "../sim/multifractal";
import { ptMoments } from "../sim/ptMoments";
import { zzCorrelations } from "../sim/correlations";
import { structureFactor } from "../sim/structureFactor";
import { symmetrySectors } from "../sim/symmetrySectors";
import { entanglementHamiltonian } from "../sim/entanglementHamiltonian";
import { coherenceFromAmplitudes } from "../sim/coherence";
import { discreteWigner } from "../sim/wigner";
import { husimiQ } from "../sim/husimi";
import { magic } from "../sim/magic";
import { magicSpectrum } from "../sim/magicSpectrum";
import { characteristicFunction } from "../sim/charFunction";
import { majoranaStars } from "../sim/majoranaStars";
import { anticoncentration } from "../sim/anticoncentration";
import { allPauliExpectations } from "../sim/pauliSpectrum";

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

/** Value of a qubit / int / choice input of analysis `id`. */
function num(id: string, key: string, opts: Opts, n: number): number {
  const spec = ANALYSIS_BY_ID[id].inputs.find((s) => s.key === key)!;
  return inputValue(spec, opts, n);
}
const probsOf = (state: Float64Array, n: number) =>
  Array.from({ length: 1 << n }, (_, i) => state[2 * i] ** 2 + state[2 * i + 1] ** 2);
const bits = (i: number, k: number) => i.toString(2).padStart(k, "0");
const qs = (A: number[]) => A.map((q) => `q${q}`).join(" ");

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

Object.assign(RUNS, {
  anticoncentration(ctx) {
    const res = anticoncentration(ctx.state, ctx.n)!;
    return {
      scalars: [{ label: "collision ratio R = D·Σp²", value: r3(res.collisionRatio) }],
      charts: [{ kind: "hist", centers: res.centers, values: res.density, xLabel: "y = D·p", yLabel: "density",
        curve: { name: "Porter–Thomas e^(−y)", y: res.ptCurve } }],
      notes: ["R ≈ 1 flat · R ≈ 2 Porter–Thomas (anticoncentrated) · R ≫ 2 peaked."],
    };
  },

  wigner(ctx) {
    const { n, state } = ctx;
    const res = discreteWigner(state, n)!;
    const labels = [...Array(res.dim).keys()].map((i) => bits(i, n));
    return {
      scalars: [{ label: "negativity Σ|W<0|", value: r3(res.negativity) }, { label: "min W", value: r3(res.minW) }],
      charts: [{ kind: "heatmap", scale: "div", rows: labels, cols: labels, values: res.W, title: "W(q, p): rows q (Z), cols p (X)" }],
      notes: ["For n ≥ 2 some entangled stabilizer states also go negative (qubit Wigner is not Clifford-covariant); use Magic for a rigorous measure."],
    };
  },

  husimi(ctx) {
    const res = husimiQ(ctx.state, ctx.n, 17, 32)!;
    return {
      scalars: [{ label: "max Q", value: r3(res.max) }],
      charts: [{
        kind: "heatmap", scale: "seq", min: 0, max: res.max,
        rows: Array.from({ length: 17 }, (_, i) => (i % 4 === 0 ? `${Math.round((180 * i) / 16)}°` : "")),
        cols: Array.from({ length: 32 }, (_, j) => (j % 8 === 0 ? `${Math.round((360 * j) / 32)}°` : "")),
        values: res.Q, title: "Q(θ, φ): rows θ (0 = |0…0⟩), cols φ",
      }],
    };
  },

  magic(ctx) {
    const { n, state } = ctx;
    const res = magic(allPauliExpectations(state, n), n);
    return {
      scalars: [{ label: "M₂", value: r3(res.m2), unit: "bits" }],
      charts: [{ kind: "bars", title: "Pauli-weight distribution Σ_{|P|=w} ⟨P⟩²/2ⁿ", labels: res.weightDist.map((_, w) => `w=${w}`), values: res.weightDist, max: 1 }],
      notes: ["M₂ = 0 exactly for stabilizer states. A single T|+⟩ has M₂ = log₂(4/3) ≈ 0.415."],
    };
  },

  magicspectrum(ctx) {
    const { n, state } = ctx;
    const res = magicSpectrum(allPauliExpectations(state, n), n);
    return {
      scalars: [{ label: "M₂", value: r3(res.m2), unit: "bits" }],
      charts: [{ kind: "lines", x: res.alphas, xLabel: "α", yLabel: "M_α (bits)", series: [{ name: "M_α", y: res.m }], yMin: 0 }],
    };
  },

  charfunction(ctx) {
    const { n, state } = ctx;
    const res = characteristicFunction(state, n)!;
    const labels = [...Array(res.dim).keys()].map((i) => bits(i, n));
    return {
      scalars: [{ label: "Σ|χ|", value: r3(res.total) }],
      charts: [{ kind: "heatmap", scale: "seq", min: 0, max: 1, rows: labels, cols: labels, values: res.mag, title: "|χ(u,v)|: rows X-support u, cols Z-support v" }],
    };
  },

  majorana(ctx) {
    const res = majoranaStars(ctx.state, ctx.n)!;
    return {
      scalars: [{ label: "symmetric weight", value: r3(res.symmetricWeight) }],
      charts: [{ kind: "stars", stars: res.stars }],
      notes: res.symmetricWeight < 0.999 ? ["The state is not permutation-symmetric; the stars show its symmetric component."] : [],
    };
  },

  tripartite(ctx, opts) {
    const { n, state } = ctx;
    const [a, b, c] = ["a", "b", "c"].map((k) => num("tripartite", k, opts, n));
    const res = tripartiteInformation(state, n, a, b, c);
    if (!res) return { error: "pick three different qubits" };
    return {
      scalars: [
        { label: "I₃", value: r3(res.i3), unit: "bits" },
        { label: "I(A:B)", value: r3(res.iAB), unit: "bits" },
        { label: "I(A:C)", value: r3(res.iAC), unit: "bits" },
        { label: "I(A:BC)", value: r3(res.iABC), unit: "bits" },
      ],
      notes: ["I₃ < 0: information about A lives in B and C jointly (scrambling)."],
    };
  },

  totalcorr(ctx) {
    const res = totalCorrelation(ctx.state, ctx.n)!;
    return {
      scalars: [{ label: "total correlation", value: r3(res.total), unit: "bits" }],
      charts: [{ kind: "bars", title: "S(qᵢ)", labels: qlabels(ctx.n), values: res.perQubit, max: 1, unit: "bits" }],
    };
  },

  chsh(ctx) {
    const res = chshMap(ctx.state, ctx.n)!;
    return {
      scalars: [{ label: "max S", value: r3(res.max) }, { label: "Tsirelson bound", value: r3(2 * Math.SQRT2) }],
      charts: [{ kind: "heatmap", scale: "seq", min: 0, max: 2 * Math.SQRT2, rows: qlabels(ctx.n), cols: qlabels(ctx.n), values: res.s, title: "S_max(i,j)" }],
      notes: ["S > 2 violates the CHSH inequality: the pair is nonlocal."],
    };
  },

  discord(ctx) {
    const res = quantumDiscordMap(ctx.state, ctx.n)!;
    return {
      scalars: [{ label: "max D", value: r3(res.max), unit: "bits" }],
      charts: [{ kind: "heatmap", scale: "seq", min: 0, max: 1, rows: qlabels(ctx.n), cols: qlabels(ctx.n), values: res.d, title: "D(row | col measured)" }],
    };
  },

  zz(ctx) {
    const res = zzCorrelations(ctx.state, ctx.n)!;
    return {
      charts: [
        { kind: "heatmap", scale: "div", min: -1, max: 1, rows: qlabels(ctx.n), cols: qlabels(ctx.n), values: res.conn, title: "⟨ZᵢZⱼ⟩ − ⟨Zᵢ⟩⟨Zⱼ⟩" },
        { kind: "bars", title: "⟨Zᵢ⟩", labels: qlabels(ctx.n), values: res.z, signed: true, max: 1 },
      ],
    };
  },

  corrlength(ctx) {
    const res = correlationLength(ctx.state, ctx.n)!;
    const pts = res.r.map((r, i) => [r, res.g[i]] as const).filter(([, g]) => g > 1e-6);
    return {
      scalars: [{ label: "ξ", value: Number.isFinite(res.xi) ? r3(res.xi) : "∞ (no decay)", unit: Number.isFinite(res.xi) ? "sites" : undefined }],
      charts: [{
        kind: "scatter", x: pts.map((p) => p[0]), y: pts.map((p) => Math.log(p[1])), xLabel: "distance r", yLabel: "ln g(r)",
        fit: Number.isFinite(res.xi) ? { a: res.intercept, b: -1 / res.xi, label: `ξ = ${r3(res.xi)}` } : undefined,
      }],
    };
  },

  structure(ctx) {
    const res = structureFactor(ctx.state, ctx.n, 49)!;
    return {
      scalars: [{ label: "peak k", value: `${r3(res.peakK / Math.PI)}π` }, { label: "S(peak)", value: r3(res.peakS) }],
      charts: [{ kind: "lines", x: res.k.map((k) => k / Math.PI), xLabel: "k / π", yLabel: "S(k)", series: [{ name: "S(k)", y: res.s }] }],
    };
  },

  symmetry(ctx) {
    const res = symmetrySectors(probsOf(ctx.state, ctx.n), ctx.n);
    return {
      scalars: [
        { label: "⟨ΠZ⟩ parity", value: r3(res.parityExpectation) },
        { label: "number conserved", value: res.numberConserved ? "yes" : "no" },
        { label: "parity conserved", value: res.parityConserved ? "yes" : "no" },
      ],
      charts: [{ kind: "bars", title: "weight by number of 1s", labels: res.weightSectors.map((_, k) => `k=${k}`), values: res.weightSectors, max: 1 }],
    };
  },

  counting(ctx, opts) {
    const { n, state } = ctx;
    const A = cutOf(opts, "cut", n, defaultCut(n));
    const res = countingStatistics(state, n, A)!;
    return {
      scalars: [{ label: "A", value: qs(A) }, { label: "⟨N_A⟩", value: r3(res.mean) }, { label: "Var(N_A)", value: r3(res.variance) }],
      charts: [{ kind: "bars", title: "P(N_A = m)", labels: res.p.map((_, m) => `m=${m}`), values: res.p, max: 1 }],
    };
  },

  contour(ctx, opts) {
    const { n, state } = ctx;
    const size = num("contour", "size", opts, n);
    const res = entanglementContour(state, n, size);
    if (!res) return { error: "region too large (≤ 7 qubits)" };
    return {
      scalars: [{ label: "S(region)", value: r3(res.total), unit: "bits" }],
      charts: [{ kind: "bars", title: "s(j) = S([0..j]) − S([0..j−1])", labels: res.contour.map((_, j) => `q${j}`), values: res.contour, signed: true, unit: "bits" }],
    };
  },

  schmidtgap(ctx) {
    const res = schmidtGap(ctx.state, ctx.n)!;
    return {
      charts: [{ kind: "bars", title: "λ₁ − λ₂ per cut", labels: res.gap.map((_, k) => `${k}|${k + 1}`), values: res.gap.map((g) => (Number.isFinite(g) ? g : 0)), max: 1 }],
    };
  },

  entham(ctx, opts) {
    const { n, state } = ctx;
    const A = cutOf(opts, "cut", n, defaultCut(n)).slice(0, n - 1);
    const res = entanglementHamiltonian(state, n, A);
    if (!res) return { error: "cut too large: keep the smaller side ≤ 6 qubits" };
    return {
      scalars: [{ label: "A", value: qs(A) }, { label: "S(A)", value: r3(res.entropy), unit: "bits" }, { label: "rank", value: res.rank }],
      charts: [{ kind: "bars", title: "entanglement energies ξᵢ = −ln λᵢ", labels: res.levels.map((_, i) => `ξ${i + 1}`), values: res.levels }],
    };
  },

  entstats(ctx, opts) {
    const { n, state } = ctx;
    const A = cutOf(opts, "cut", n, defaultCut(n)).slice(0, n - 1);
    const res = entanglementSpectrumStats(state, n, A);
    if (!res) return { error: "need at least 3 entanglement levels across the cut" };
    return {
      scalars: [
        { label: "⟨r⟩", value: r3(res.meanR) }, { label: "Poisson", value: 0.386 }, { label: "GOE", value: 0.536 },
        { label: "levels", value: res.levels },
      ],
      charts: [{ kind: "bars", title: "gap ratios rᵢ", labels: res.ratios.map((_, i) => `r${i + 1}`), values: res.ratios, max: 1 }],
    };
  },

  mps(ctx, opts) {
    const target = num("mps", "target", opts, ctx.n);
    const res = mpsBondDimension(ctx.state, ctx.n, target)!;
    return {
      scalars: [{ label: "max χ", value: res.maxChi }, { label: "worst cut", value: `${res.worstCut}|${res.worstCut + 1}` }],
      charts: [
        { kind: "bars", title: "required χ per cut", labels: res.chi.map((_, k) => `${k}|${k + 1}`), values: res.chi.map((c) => (Number.isFinite(c) ? c : 0)) },
        { kind: "lines", title: "truncation error at the worst cut", x: res.truncError.map((_, i) => i + 1), xLabel: "χ", yLabel: "ε(χ)",
          series: [{ name: "ε", y: res.truncError }], yMin: 0 },
      ],
    };
  },

  negspectrum(ctx, opts) {
    const { n, state } = ctx;
    const A = cutOf(opts, "cut", n, defaultCut(n)).slice(0, n - 1);
    const res = negativitySpectrum(state, n, A)!;
    return {
      scalars: [{ label: "A", value: qs(A) }, { label: "negativity 𝒩", value: r3(res.negativity) }, { label: "E_N", value: r3(res.logNegativity), unit: "ebits" }],
      charts: [{ kind: "bars", title: "eigenvalues of ρ^T_A", labels: res.eigenvalues.map((_, i) => `λ${i + 1}`), values: res.eigenvalues, signed: true }],
    };
  },

  ptmoments(ctx, opts) {
    const { n, state } = ctx;
    const A = cutOf(opts, "cut", n, defaultCut(n)).slice(0, n - 1);
    const res = ptMoments(state, n, A)!;
    return {
      scalars: [
        { label: "p₂", value: r3(res.p2) }, { label: "p₃", value: r3(res.p3) },
        { label: "p₃ < p₂² (entangled)", value: res.entangledByP3 ? "yes" : "no" },
      ],
      charts: [{ kind: "bars", title: "pₙ = Tr[(ρ^T_A)ⁿ]", labels: res.moments.map((_, i) => `p${i + 1}`), values: res.moments, max: 1 }],
    };
  },

  threetangle(ctx, opts) {
    const a = num("threetangle", "a", opts, 3);
    const res = threeTangle(ctx.state, 3, a, (a + 1) % 3, (a + 2) % 3)!;
    return {
      scalars: [
        { label: "τ₃", value: r3(res.tau3) }, { label: `τ q${a}(rest)`, value: r3(res.oneTangle) },
        { label: `C²(q${a},q${(a + 1) % 3})`, value: r3(res.cab2) }, { label: `C²(q${a},q${(a + 2) % 3})`, value: r3(res.cac2) },
      ],
      notes: ["τ₃ = 1 for GHZ, 0 for W (whose entanglement is only pairwise)."],
    };
  },

  multifractal(ctx) {
    const res = multifractal(ctx.state, ctx.n)!;
    return {
      scalars: [{ label: "D₁", value: r3(res.d1) }, { label: "D₂", value: r3(res.d2) }, { label: "D∞", value: r3(res.dInf) }],
      charts: [{ kind: "lines", x: res.qs, xLabel: "q", yLabel: "D_q", series: [{ name: "D_q", y: res.dq }], yMin: 0, yMax: 1 }],
    };
  },

  coherence(ctx) {
    const res = coherenceFromAmplitudes(ctx.state, ctx.n);
    return {
      scalars: [
        { label: "l₁ coherence", value: r3(res.cL1) }, { label: "l₁ max (d − 1)", value: res.cL1Max },
        { label: "relative-entropy coherence", value: r3(res.cRel), unit: "bits" }, { label: "relative max (n)", value: res.cRelMax, unit: "bits" },
      ],
    };
  },
} satisfies Record<string, Run>);

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
