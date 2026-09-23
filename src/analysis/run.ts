/**
 * Compute side of the LAB: analysis id → result. Loaded only by the analysis
 * worker (and by InlineEngine in tests). Every numeric routine here is a
 * ported module validated against Qiskit/numpy (test/validated/*).
 */
import type { AnalysisContext, AnalysisResult, Chart, Opts } from "./types";
import { ANALYSIS_BY_ID, defaultCut, inputValue, pauliValue, symbolValue } from "./catalog";
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
import { parsePauliSum } from "../sim/trotter";
import { pauliSumExpectation } from "../sim/expectation";
import { observableMoments, shotError } from "../sim/observableVariance";
import { collectiveSpinGenerator, quantumFisherPure } from "../sim/qfi";
import { spinSqueezing } from "../sim/spinSqueezing";
import { multiparameterQFI } from "../sim/multiparamQfi";
import { quantumGeometricTensor } from "../sim/qgt";
import { blochTrajectories } from "../sim/blochPath";
import { participation, participationSweep } from "../sim/participation";
import { barrenPlateauDiagnostic, computeLandscape, optimizeExpectation } from "../sim/optimize";
import { lowerTape, namedCircuit } from "../calc/lower";
import { buildUnitary } from "../sim/unitary";
import { pauliTransferMatrix } from "../sim/ptm";
import { operatorEntanglement } from "../sim/operatorEntanglement";
import { floquetSpectrum } from "../sim/floquetSpectrum";
import { hamiltonianSpectrum } from "../sim/hamSpectrum";
import { densityOfStates } from "../sim/densityOfStates";
import { levelStatistics, POISSON_R, GOE_R } from "../sim/levelStatistics";
import { spectralFormFactor } from "../sim/spectralFormFactor";
import { krylovComplexity } from "../sim/krylov";
import { ethOffDiagonal } from "../sim/ethOffDiagonal";
import { diagonalEnsemble } from "../sim/diagonalEnsemble";
import { effectiveTemperature } from "../sim/effectiveTemperature";
import { eigenstateEntanglement } from "../sim/eigenstateEntanglement";
import { workDistribution } from "../sim/workDistribution";
import { berryPhase } from "../sim/berryPhase";
import { chernNumber } from "../sim/chernNumber";
import { zxDiagram } from "../sim/zx";
import { NONUNITARY } from "../calc/steps";
import { tSweepZ, tSweepSpectrum } from "../sim/tsweep";
import { loschmidtEcho } from "../sim/loschmidt";
import { imbalanceSweep } from "../sim/imbalance";
import { entanglementVelocity } from "../sim/entanglementVelocity";
import { negativityDynamics } from "../sim/negativityDynamics";
import { otoc } from "../sim/otoc";
import { otocLightcone } from "../sim/otocLightcone";
import { butterflyVelocity } from "../sim/butterflyVelocity";
import { lyapunovExponent } from "../sim/lyapunov";
import { operatorWeightGrowth } from "../sim/operatorWeight";
import { temporalAutocorrelation } from "../sim/autocorrelation";
import { spaceTimeZ, spaceTimeEntropy } from "../sim/spacetime";
import { entanglementAsymmetrySweep } from "../sim/entanglementAsymmetry";
import { computeLightCone } from "../sim/lightcone";
import { stepSymbols } from "../calc/steps";
import { symbolGlyph } from "../calc/entry";
import { TOOL_RUNS } from "./tools";
import { NOISE_RUNS, noisyView } from "./noiseRuns";
import { BENCH_RUNS } from "./benchRuns";

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

type Run = (ctx: AnalysisContext, opts: Opts) => AnalysisResult | Promise<AnalysisResult>;

/** The observable input, parsed; throws a readable error for bad text. */
function observable(opts: Opts, n: number, key = "obs") {
  const text = pauliValue(opts, key, n);
  const terms = parsePauliSum(text);
  if (terms[0].paulis.length !== n) throw new Error(`Pauli strings need ${n} letters (one per qubit), got ${terms[0].paulis.length}`);
  return terms;
}
/** Symbols (ASCII names) the tape uses — the same rule the register applies. */
const symbolsOfTape = (ctx: AnalysisContext) =>
  [...new Set(ctx.tape.flatMap((e) => e.flatMap(stepSymbols)))].sort();

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

Object.assign(RUNS, {
  expectation(ctx, opts) {
    const { n, state } = ctx;
    const terms = observable(opts, n);
    const m = observableMoments(state, n, terms);
    const shots = num("expectation", "shots", opts, n);
    return {
      scalars: [
        { label: "⟨H⟩", value: r3(pauliSumExpectation(state, n, terms)) },
        { label: "Var(H)", value: r3(m.variance) },
        { label: "σ", value: r3(m.std) },
        { label: `shot error (N=${shots})`, value: r3(shotError(m.std, shots)) },
      ],
      charts: terms.length > 1 ? [{
        kind: "bars", title: "term contributions hₖ⟨Pₖ⟩", signed: true,
        labels: terms.map((t) => t.paulis), values: terms.map((t) => t.coefficient * pauliSumExpectation(state, n, [{ coefficient: 1, paulis: t.paulis }])),
      }] : [],
    };
  },

  async optimise(ctx, opts) {
    const syms = symbolsOfTape(ctx);
    if (syms.length === 0) return { error: "the tape has no symbols to optimise (type θ or t into an angle)" };
    const terms = observable(opts, ctx.n);
    const method = (["adam", "sgd", "qng"] as const)[num("optimise", "method", opts, ctx.n)];
    const goal = num("optimise", "goal", opts, ctx.n) === 1 ? "maximize" : "minimize";
    const history: number[] = [];
    const res = await optimizeExpectation(lowerTape(ctx.n, ctx.tape), [], {
      symbols: syms, observable: { kind: "sum", terms }, initial: { ...ctx.scope },
      steps: num("optimise", "steps", opts, ctx.n), learningRate: 0.1, epsilon: 1e-4, goal, optimizer: method,
      onProgress: (_step, value) => { history.push(value); },
    });
    const final = Object.fromEntries(syms.map((s) => [s, res.finalParams[s] ?? 0]));
    return {
      scalars: [
        { label: `final ⟨H⟩ (${goal})`, value: r3(res.finalValue) },
        { label: "steps", value: `${res.steps} · ${res.stopped}` },
        ...syms.map((s) => ({ label: symbolGlyph(s), value: r3(final[s]) })),
      ],
      charts: [{ kind: "lines", x: history.map((_, i) => i + 1), xLabel: "step", yLabel: "⟨H⟩", series: [{ name: "⟨H⟩", y: history }] }],
      apply: { label: "use these values", scope: final },
    };
  },

  async landscape(ctx, opts) {
    const syms = symbolsOfTape(ctx);
    if (syms.length === 0) return { error: "the tape has no symbols" };
    const meta = ANALYSIS_BY_ID.landscape;
    const pick = (k: string) => symbolValue(meta.inputs.find((i) => i.key === k) as Extract<typeof meta.inputs[number], { kind: "symbol" }>, opts, syms);
    const s1 = pick("s1"), s2 = pick("s2");
    const two = s2 && s2 !== s1;
    const grid = two ? 21 : 61;
    const obs = { kind: "sum" as const, terms: observable(opts, ctx.n) };
    const out = await computeLandscape(lowerTape(ctx.n, ctx.tape), ctx.scope, [], obs, two ? [s1, s2] : [s1], grid, [-Math.PI, Math.PI]);
    const axis = Array.from({ length: grid }, (_, i) => -Math.PI + (2 * Math.PI * i) / (grid - 1));
    if (!two) {
      return { charts: [{ kind: "lines", x: axis.map((x) => x / Math.PI), xLabel: `${symbolGlyph(s1)} / π`, yLabel: "⟨H⟩", series: [{ name: "⟨H⟩", y: out[0] }] }] };
    }
    const lab = (i: number) => (i % 5 === 0 ? `${r3(axis[i] / Math.PI)}π` : "");
    return {
      charts: [{
        kind: "heatmap", scale: "div", rows: axis.map((_, i) => lab(i)), cols: axis.map((_, i) => lab(i)), values: out,
        title: `⟨H⟩: rows ${symbolGlyph(s2)}, cols ${symbolGlyph(s1)} (both −π … π)`,
      }],
    };
  },

  async plateau(ctx, opts) {
    const syms = symbolsOfTape(ctx);
    if (syms.length === 0) return { error: "the tape has no symbols" };
    const res = await barrenPlateauDiagnostic(lowerTape(ctx.n, ctx.tape), [], { kind: "sum", terms: observable(opts, ctx.n) }, syms, num("plateau", "samples", opts, ctx.n));
    return {
      charts: [{
        kind: "table", headers: ["symbol", "Var ∂⟨H⟩", "mean ∂⟨H⟩"],
        rows: syms.map((s, i) => [symbolGlyph(s), res.variancePerSymbol[i].toExponential(3), r3(res.meanGradPerSymbol[i])]),
      }],
      notes: ["Random points are drawn afresh on every run."],
    };
  },

  qfi(ctx, opts) {
    const axis = (["X", "Y", "Z"] as const)[num("qfi", "axis", opts, ctx.n)];
    const res = quantumFisherPure(ctx.state, ctx.n, collectiveSpinGenerator(ctx.n, axis));
    return {
      scalars: [
        { label: `F_Q (J${axis.toLowerCase()})`, value: r3(res.qfi) }, { label: "F_Q / N", value: r3(res.qfiDensity) },
        { label: "SQL (N)", value: res.sql }, { label: "Heisenberg (N²)", value: res.heisenberg },
        { label: "entanglement witnessed", value: res.witnessesEntanglement ? "yes (F_Q > N)" : "no" },
      ],
    };
  },

  multiqfi(ctx) {
    const res = multiparameterQFI(ctx.state, ctx.n)!;
    const L = ["Jx", "Jy", "Jz"];
    return {
      scalars: [{ label: "max eigenvalue", value: r3(res.maxEig) }, { label: "det F", value: r3(res.det) }],
      charts: [{ kind: "heatmap", scale: "div", rows: L, cols: L, values: res.F, title: "F_ab" }],
    };
  },

  squeezing(ctx) {
    const res = spinSqueezing(ctx.state, ctx.n)!;
    return {
      scalars: [
        { label: "ξ²", value: Number.isFinite(res.xiR2) ? r3(res.xiR2) : "undefined (⟨J⟩ = 0)" },
        { label: "gain", value: Number.isFinite(res.xiR2) ? `${r3(res.dB)} dB` : "—" },
        { label: "|⟨J⟩|", value: r3(res.meanLength) },
        { label: "squeezed", value: res.squeezed ? "yes" : "no" },
      ],
      notes: res.meanLength < 1e-9 ? ["No mean spin (e.g. GHZ): use the QFI instead."] : [],
    };
  },

  qgt(ctx) {
    const syms = symbolsOfTape(ctx);
    if (syms.length === 0) return { error: "the tape has no symbols" };
    const res = quantumGeometricTensor(lowerTape(ctx.n, ctx.tape), [], ctx.scope, syms.slice(0, 8));
    if (!res) return { error: "needs n ≤ 12 and ≤ 8 symbols" };
    const L = res.symbols.map(symbolGlyph);
    return {
      scalars: [{ label: "det g", value: r3(res.metricDet) }, { label: "eigenvalues of g", value: res.metricEigenvalues.map(r3).join(", ") }],
      charts: [
        { kind: "heatmap", scale: "div", rows: L, cols: L, values: res.metric, title: "Fubini–Study metric g" },
        { kind: "heatmap", scale: "div", rows: L, cols: L, values: res.berry, title: "Berry curvature F" },
      ],
    };
  },

  blochpath(ctx, opts) {
    if (!(ctx.scope.t !== undefined && symbolsOfTape(ctx).includes("t"))) return { error: "needs t in the tape (2ND . in an angle)" };
    const q = num("blochpath", "q", opts, ctx.n);
    const res = blochTrajectories(lowerTape(ctx.n, ctx.tape), ctx.scope, [], 64)!;
    return { charts: [{ kind: "paths", paths: [{ label: `q${q}`, points: res.path[q] }] }], notes: ["Measurements are post-selected on their recorded outcomes."] };
  },

  participation(ctx) {
    const { n, state } = ctx;
    const p = participation(probsOf(state, n), n);
    const sweep = ctx.tape.length ? participationSweep(lowerTape(n, ctx.tape), ctx.scope, [], { maxCols: 400 }) : null;
    return {
      scalars: [
        { label: "IPR Σp²", value: r3(p.ipr) }, { label: "participation ratio", value: r3(p.participationRatio) },
        { label: "PR / 2ⁿ", value: r3(p.fraction) }, { label: "Shannon (nats)", value: r3(p.shannon) },
      ],
      charts: sweep ? [{ kind: "lines", x: sweep.pr.map((_, i) => i + 1), xLabel: "step", yLabel: "PR", series: [{ name: "PR", y: sweep.pr }], yMin: 1 }] : [],
    };
  },
} satisfies Record<string, Run>);

/** Unitary-based analyses need a tape without measurements, resets or state preps. */
function requireUnitary(ctx: AnalysisContext) {
  if (ctx.tape.some((e) => e.some((s) => NONUNITARY.has(s.gateId)))) {
    throw new Error("the tape isn't unitary (it measures, resets or prepares a state)");
  }
}
const basisLabels = (n: number) => Array.from({ length: 1 << n }, (_, i) => i.toString(2).padStart(n, "0"));
/** Two symbol inputs (s1, s2) of an analysis, resolved against the tape. */
function twoSymbols(id: string, ctx: AnalysisContext, opts: Opts): [string, string] {
  const syms = symbolsOfTape(ctx);
  if (syms.length < 2) throw new Error("needs two symbols in the tape (e.g. θ and φ)");
  const meta = ANALYSIS_BY_ID[id];
  const pick = (k: string) => symbolValue(meta.inputs.find((i) => i.key === k) as Extract<typeof meta.inputs[number], { kind: "symbol" }>, opts, syms);
  const a = pick("s1"), b = pick("s2");
  if (a === b) throw new Error("pick two different symbols");
  return [a, b];
}
/** Group energies into levels (value, degeneracy). */
function levelsOf(E: number[]) {
  const out: { e: number; g: number }[] = [];
  for (const e of E) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.e - e) < 1e-8) last.g++;
    else out.push({ e, g: 1 });
  }
  return out;
}
const isDegenerate = (E: number[]) => levelsOf(E).some((l) => l.g > 1);

Object.assign(RUNS, {
  unitary(ctx) {
    requireUnitary(ctx);
    const U = buildUnitary(lowerTape(ctx.n, ctx.tape), ctx.scope, [])!;
    const d = U.dim, L = basisLabels(ctx.n);
    const re = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => U.mag[i * d + j] * Math.cos(U.phase[i * d + j])));
    const im = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => U.mag[i * d + j] * Math.sin(U.phase[i * d + j])));
    return { charts: [{ kind: "heatmap", scale: "complex", rows: L, cols: L, values: re, imag: im, title: "U: rows = output, cols = input" }] };
  },

  ptm(ctx) {
    requireUnitary(ctx);
    const res = pauliTransferMatrix(lowerTape(ctx.n, ctx.tape), ctx.scope, [])!;
    return { charts: [{ kind: "heatmap", scale: "div", min: -1, max: 1, rows: res.labels, cols: res.labels, values: res.R, title: "R_ij (row i = output Pauli)" }] };
  },

  opent(ctx) {
    requireUnitary(ctx);
    const res = operatorEntanglement(lowerTape(ctx.n, ctx.tape), ctx.scope, [])!;
    return {
      scalars: [{ label: "E_op", value: r3(res.entropy), unit: "ebits" }, { label: "cut", value: `q0…q${res.cutA - 1} | rest` }],
      charts: [{ kind: "bars", title: "operator-Schmidt coefficients", labels: res.spectrum.map((_, i) => `λ${i + 1}`), values: res.spectrum, max: 1 }],
    };
  },

  floquet(ctx) {
    requireUnitary(ctx);
    const res = floquetSpectrum(lowerTape(ctx.n, ctx.tape), ctx.scope, [])!;
    return {
      scalars: [{ label: "⟨r⟩ (circular)", value: r3(res.meanR) }, { label: "Poisson", value: 0.386 }, { label: "COE", value: 0.527 }],
      charts: [{ kind: "phases", phases: res.quasiEnergies }],
    };
  },

  hamspectrum(ctx, opts) {
    const terms = observable(opts, ctx.n);
    const res = hamiltonianSpectrum(terms, ctx.n)!;
    const e = pauliSumExpectation(ctx.state, ctx.n, terms);
    const lv = levelsOf(res.energies);
    return {
      scalars: [
        { label: "ground E₀", value: r3(res.ground) }, { label: "gap E₁ − E₀", value: r3(lv.length > 1 ? lv[1].e - lv[0].e : 0) },
        { label: "⟨H⟩ of the state", value: r3(e) }, { label: "levels (degenerate)", value: `${lv.length} (${lv.filter((l) => l.g > 1).length})` },
      ],
      charts: [{ kind: "levels", energies: res.energies, marker: { label: "⟨H⟩", value: e } }],
    };
  },

  dos(ctx, opts) {
    const res = densityOfStates(hamiltonianSpectrum(observable(opts, ctx.n), ctx.n)!.energies)!;
    return { charts: [{ kind: "hist", centers: res.centers, values: res.counts, xLabel: "E", yLabel: "levels" }] };
  },

  levelstats(ctx, opts) {
    const res = levelStatistics(hamiltonianSpectrum(observable(opts, ctx.n), ctx.n)!.energies)!;
    const centers = res.hist.map((_, k) => (k + 0.5) / res.bins);
    return {
      scalars: [
        { label: "⟨r⟩", value: r3(res.meanRatio) }, { label: "Poisson", value: r3(POISSON_R) }, { label: "GOE", value: r3(GOE_R) },
        { label: "degenerate gaps", value: `${Math.round(res.degenerateFraction * 100)}%` },
      ],
      charts: [{ kind: "hist", centers, values: res.hist, xLabel: "r", yLabel: "P(r)", curve: { name: "Poisson 2/(1+r)²", y: centers.map((r) => 2 / (1 + r) ** 2) } }],
      notes: res.degenerateFraction > 0 ? ["Degeneracies (symmetries) pull ⟨r⟩ down; restrict to one symmetry sector for a clean chaos test."] : [],
    };
  },

  sff(ctx, opts) {
    const res = spectralFormFactor(hamiltonianSpectrum(observable(opts, ctx.n), ctx.n)!.energies, 120)!;
    return {
      scalars: [{ label: "plateau", value: r3(res.plateau) }, { label: "Heisenberg time", value: r3(res.heisenbergTime) }],
      charts: [{ kind: "lines", x: res.t, xLabel: "t (log)", yLabel: "SFF (log)", logX: true, logY: true,
        series: [{ name: "SFF", y: res.sff.map((v) => Math.max(v, 1e-12)) }, { name: "plateau", y: res.t.map(() => res.plateau), dashed: true }] }],
    };
  },

  krylov(ctx, opts) {
    const res = krylovComplexity(observable(opts, ctx.n), ctx.state, ctx.n)!;
    return {
      scalars: [{ label: "Krylov dimension", value: res.krylovDim }, { label: "max C(t)", value: r3(res.maxComplexity) }],
      charts: [
        { kind: "bars", title: "Lanczos bₙ", labels: res.b.map((_, i) => `b${i + 1}`), values: res.b },
        { kind: "lines", title: "spread complexity", x: res.times, xLabel: "t", yLabel: "C(t)", series: [{ name: "C(t)", y: res.complexity }], yMin: 0 },
      ],
    };
  },

  diagens(ctx, opts) {
    const res = diagonalEnsemble(observable(opts, ctx.n), ctx.state, ctx.n)!;
    const lv: { e: number; w: number }[] = [];
    res.energies.forEach((e, k) => {
      const last = lv[lv.length - 1];
      if (last && Math.abs(last.e - e) < 1e-8) last.w += res.populations[k];
      else lv.push({ e, w: res.populations[k] });
    });
    const dEff = 1 / lv.reduce((s, l) => s + l.w * l.w, 0);
    return {
      scalars: [
        { label: "⟨H⟩", value: r3(res.meanEnergy) }, { label: "ΔE", value: r3(res.energySpread) },
        { label: "effective dimension (levels)", value: r3(dEff) },
      ],
      charts: [{ kind: "scatter", x: lv.map((l) => l.e), y: lv.map((l) => l.w), xLabel: "E", yLabel: "weight" }],
    };
  },

  efftemp(ctx, opts) {
    const terms = observable(opts, ctx.n);
    const E = hamiltonianSpectrum(terms, ctx.n)!.energies;
    if (isDegenerate(E)) return { error: "H has degenerate levels: per-eigenstate populations aren't defined; use a generic H" };
    const res = effectiveTemperature(diagonalEnsemble(terms, ctx.state, ctx.n)!);
    const pts = res.energies.map((e, k) => [e, res.logPop[k]] as const).filter(([, y]) => Number.isFinite(y));
    return {
      scalars: [{ label: "β", value: r3(res.beta) }, { label: "T = 1/β", value: Number.isFinite(res.temperature) ? r3(res.temperature) : "∞" }, { label: "R²", value: r3(res.r2) }],
      charts: [{ kind: "scatter", x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), xLabel: "E", yLabel: "ln pₖ",
        fit: { a: res.intercept, b: -res.beta, label: `β = ${r3(res.beta)}` } }],
    };
  },

  eth(ctx, opts) {
    const terms = observable(opts, ctx.n);
    if (isDegenerate(hamiltonianSpectrum(terms, ctx.n)!.energies)) return { error: "H has degenerate levels: use a generic H" };
    const res = ethOffDiagonal(terms, observable(opts, ctx.n, "o"), ctx.n)!;
    const pts = res.offDiag.filter((p) => p.mag2 > 1e-14);
    return {
      scalars: [{ label: "mean |O_mn|²", value: res.meanOffDiag.toExponential(2) }],
      charts: [
        { kind: "scatter", title: "off-diagonal", x: pts.map((p) => p.omega), y: pts.map((p) => Math.log10(p.mag2)), xLabel: "ω = Eₘ − Eₙ", yLabel: "log₁₀ |O_mn|²" },
        { kind: "scatter", title: "diagonal", x: res.diag.map((p) => p.energy), y: res.diag.map((p) => p.value), xLabel: "E", yLabel: "⟨E|O|E⟩" },
      ],
    };
  },

  eigent(ctx, opts) {
    const terms = observable(opts, ctx.n);
    if (isDegenerate(hamiltonianSpectrum(terms, ctx.n)!.energies)) return { error: "H has degenerate levels: eigenstates aren't unique; use a generic H" };
    const res = eigenstateEntanglement(terms, ctx.n)!;
    return {
      scalars: [{ label: "max (Page ceiling)", value: res.maxEntropy, unit: "bits" }],
      charts: [{ kind: "scatter", x: res.energies, y: res.entropies, xLabel: "E", yLabel: "S(half) bits" }],
    };
  },

  workdist(ctx, opts) {
    requireUnitary(ctx);
    const res = workDistribution(observable(opts, ctx.n), lowerTape(ctx.n, ctx.tape), ctx.scope, [])!;
    return {
      scalars: [{ label: "⟨W⟩", value: r3(res.meanWork) }, { label: "Var(W)", value: r3(res.variance) }],
      charts: [{ kind: "hist", centers: res.works, values: res.probs, xLabel: "W", yLabel: "P(W)" }],
    };
  },

  berry(ctx, opts) {
    const [a, b] = twoSymbols("berry", ctx, opts);
    const res = berryPhase(lowerTape(ctx.n, ctx.tape), ctx.scope, [], a, b, num("berry", "radius", opts, ctx.n), 16)!;
    return {
      scalars: [
        { label: "γ", value: `${r3(res.gamma)} = ${r3(res.gamma / Math.PI)}π` },
        { label: "|Π⟨ψₖ|ψₖ₊₁⟩|", value: r3(res.overlapMagnitude) },
        { label: "loop", value: `${symbolGlyph(a)}, ${symbolGlyph(b)} around (${r3(ctx.scope[a] ?? 0)}, ${r3(ctx.scope[b] ?? 0)})` },
      ],
      notes: res.overlapMagnitude < 0.5 ? ["Small overlap product: the loop is too coarse or crosses a degeneracy."] : [],
    };
  },

  chern(ctx, opts) {
    const [a, b] = twoSymbols("chern", ctx, opts);
    const grid = num("chern", "grid", opts, ctx.n);
    const res = chernNumber(lowerTape(ctx.n, ctx.tape), ctx.scope, [], a, b, grid)!;
    const lab = (k: number) => (k % Math.max(1, Math.floor(grid / 4)) === 0 ? `${r3((2 * k) / grid)}π` : "");
    return {
      scalars: [{ label: "Chern number C", value: r3(res.chern) }],
      charts: [{ kind: "heatmap", scale: "div", min: -Math.PI, max: Math.PI, rows: Array.from({ length: grid }, (_, k) => lab(k)),
        cols: Array.from({ length: grid }, (_, k) => lab(k)), values: res.curvature, title: `Berry flux: rows ${symbolGlyph(a)}, cols ${symbolGlyph(b)}` }],
    };
  },

  zx(ctx) {
    const res = zxDiagram(namedCircuit(ctx.n, ctx.tape));
    return {
      scalars: [{ label: "fusable spider pairs", value: res.fusableHint }],
      charts: [{ kind: "zx", numQubits: res.numQubits, numCols: res.numCols, nodes: res.nodes, edges: res.edges }],
    };
  },
} satisfies Record<string, Run>);

/** t-sweep analyses need the symbol t in the tape. */
function requireT(ctx: AnalysisContext) {
  if (!symbolsOfTape(ctx).includes("t")) throw new Error("needs the symbol t in an angle (2ND . on the keypad)");
}
const POST_SELECTED = "Measurements are post-selected on their recorded outcomes.";
const tAxis = (ts: number[]) => ts.map((t) => t / Math.PI);
const stepLabels = (k: number) => Array.from({ length: k }, (_, i) => (k <= 16 || i % Math.ceil(k / 16) === 0 ? `${i + 1}` : ""));

Object.assign(RUNS, {
  tsweep(ctx) {
    requireT(ctx);
    const res = tSweepZ(lowerTape(ctx.n, ctx.tape), ctx.scope, [], 64)!;
    return {
      charts: [{ kind: "lines", x: tAxis(res.ts), xLabel: "t / π", yLabel: "⟨Z⟩", yMin: -1, yMax: 1,
        series: res.z.slice(0, 3).map((y, q) => ({ name: `q${q}`, y })) }],
      notes: [...(ctx.n > 3 ? ["Showing q0–q2 (three series max, for legibility)."] : []), POST_SELECTED],
    };
  },

  tsweepfft(ctx, opts) {
    requireT(ctx);
    const q = num("tsweepfft", "q", opts, ctx.n);
    const res = tSweepSpectrum(lowerTape(ctx.n, ctx.tape), ctx.scope, [], 64)!;
    const m = res.mag[q].slice(0, 17);
    return { charts: [{ kind: "bars", title: `|FT ⟨Z_q${q}⟩| (bin = oscillations per period)`, labels: m.map((_, i) => `${i}`), values: m }] };
  },

  loschmidt(ctx) {
    requireT(ctx);
    const res = loschmidtEcho(lowerTape(ctx.n, ctx.tape), ctx.scope, [], 96)!;
    return {
      charts: [
        { kind: "lines", title: "return probability L(t)", x: tAxis(res.ts), xLabel: "t / π", yLabel: "L", yMin: 0, yMax: 1, series: [{ name: "L", y: res.L }] },
        { kind: "lines", title: "rate function λ(t) = −ln L / n", x: tAxis(res.ts), xLabel: "t / π", yLabel: "λ", yMin: 0, series: [{ name: "λ", y: res.rate }] },
      ],
      notes: [POST_SELECTED],
    };
  },

  imbalance(ctx) {
    requireT(ctx);
    const res = imbalanceSweep(lowerTape(ctx.n, ctx.tape), ctx.scope, [], 64)!;
    return {
      scalars: [{ label: "late-time |I| (plateau)", value: r3(res.plateau) }],
      charts: [{ kind: "lines", x: tAxis(res.ts), xLabel: "t / π", yLabel: "I(t)", yMin: -1, yMax: 1, series: [{ name: "I", y: res.imbalance }] }],
    };
  },

  entvelocity(ctx) {
    requireT(ctx);
    const res = entanglementVelocity(lowerTape(ctx.n, ctx.tape), ctx.scope, [], 64);
    if (!res) return { error: "half cut too large (≤ 6 qubits a side)" };
    return {
      scalars: [{ label: "v_E = max dS/dt", value: r3(res.velocity), unit: "bits per unit t" }, { label: "at t", value: `${r3(res.velocityAt / Math.PI)}π` }],
      charts: [{ kind: "lines", x: tAxis(res.ts), xLabel: "t / π", yLabel: "S (bits)", yMin: 0, series: [{ name: "S(half)", y: res.entropy }] }],
    };
  },

  negdyn(ctx, opts) {
    requireT(ctx);
    const A = cutOf(opts, "cut", ctx.n, defaultCut(ctx.n)).slice(0, ctx.n - 1);
    const res = negativityDynamics(lowerTape(ctx.n, ctx.tape), ctx.scope, [], A, 64);
    if (!res) return { error: "cut too large (≤ 6 qubits a side)" };
    return {
      scalars: [{ label: "A", value: qs(A) }, { label: "max E_N", value: r3(res.maxLogNeg), unit: "ebits" }],
      charts: [{ kind: "lines", x: tAxis(res.ts), xLabel: "t / π", yLabel: "E_N", yMin: 0, series: [{ name: "E_N", y: res.logNeg }] }],
    };
  },

  otoc(ctx, opts) {
    requireT(ctx);
    const w = num("otoc", "w", opts, ctx.n), v = num("otoc", "v", opts, ctx.n);
    const res = otoc(lowerTape(ctx.n, ctx.tape), ctx.scope, [], w, v, "Z", "Z", 48)!;
    return { charts: [{ kind: "lines", x: tAxis(res.ts), xLabel: "t / π", yLabel: "C(t)", yMin: 0, series: [{ name: `W=Z${w}, V=Z${v}`, y: res.C }] }] };
  },

  otoccone(ctx, opts) {
    requireT(ctx);
    const w = num("otoccone", "w", opts, ctx.n);
    const res = otocLightcone(lowerTape(ctx.n, ctx.tape), ctx.scope, [], w, "Z", "Z", 28)!;
    return {
      charts: [{ kind: "heatmap", scale: "seq", min: 0, max: Math.max(res.maxC, 1e-9), rows: qlabels(ctx.n),
        cols: res.ts.map((t, i) => (i % 7 === 0 ? `${r3(t / Math.PI)}π` : "")), values: res.grid, title: `C(q, t) with W = Z on q${w}` }],
    };
  },

  butterfly(ctx, opts) {
    requireT(ctx);
    const w = num("butterfly", "w", opts, ctx.n);
    const res = butterflyVelocity(lowerTape(ctx.n, ctx.tape), ctx.scope, [], w, "Z", "Z", 0.5, 32)!;
    const pts = res.series.filter((s) => s.arrival !== null);
    return {
      scalars: [{ label: "v_B", value: res.vB === null ? "— (front reaches < 2 sites)" : r3(res.vB), unit: res.vB === null ? undefined : "sites per unit t" }],
      charts: pts.length ? [{ kind: "scatter", x: pts.map((s) => s.arrival as number), y: pts.map((s) => s.distance), xLabel: "arrival t* (C = ½)", yLabel: "distance",
        fit: res.vB === null ? undefined : { a: res.intercept, b: res.vB, label: `v_B = ${r3(res.vB)}` } }] : [],
    };
  },

  lyapunov(ctx, opts) {
    requireT(ctx);
    const w = num("lyapunov", "w", opts, ctx.n), v = num("lyapunov", "v", opts, ctx.n);
    const res = lyapunovExponent(lowerTape(ctx.n, ctx.tape), ctx.scope, [], w, v, 48)!;
    const pts = res.ts.map((t, k) => [t, res.lnC[k]] as const).filter(([, y]) => Number.isFinite(y));
    return {
      scalars: [{ label: "λ_L", value: Number.isFinite(res.lyapunov) ? r3(res.lyapunov) : "— (no clean growth window)" }],
      charts: pts.length >= 2 ? [{ kind: "scatter", x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), xLabel: "t", yLabel: "ln C",
        fit: Number.isFinite(res.lyapunov) ? { a: res.intercept, b: res.lyapunov, label: `λ = ${r3(res.lyapunov)}` } : undefined }] : [],
    };
  },

  opweight(ctx, opts) {
    requireT(ctx);
    const w = num("opweight", "w", opts, ctx.n);
    const res = operatorWeightGrowth(lowerTape(ctx.n, ctx.tape), ctx.scope, [], w, "Z", 24)!;
    const rows = Array.from({ length: ctx.n + 1 }, (_, k) => res.weights.map((row) => row[k]));
    return {
      charts: [{ kind: "heatmap", scale: "seq", min: 0, max: 1, rows: rows.map((_, k) => `w=${k}`),
        cols: res.ts.map((t, i) => (i % 6 === 0 ? `${r3(t / Math.PI)}π` : "")), values: rows, title: "weight by support size, over t" }],
    };
  },

  autocorr(ctx, opts) {
    requireT(ctx);
    const q = num("autocorr", "q", opts, ctx.n);
    const res = temporalAutocorrelation(lowerTape(ctx.n, ctx.tape), ctx.scope, [], q, 49)!;
    return {
      charts: [
        { kind: "lines", x: tAxis(res.ts), xLabel: "t / π", yLabel: "⟨Z(t)Z⟩", yMin: -1, yMax: 1, series: [{ name: `q${q}`, y: res.C }] },
        { kind: "bars", title: "spectrum (oscillations per period)", labels: res.freqs.slice(0, 13).map(String), values: res.spectrum.slice(0, 13) },
      ],
    };
  },

  spacetime(ctx) {
    if (!ctx.tape.length) return { error: "the tape is empty" };
    const res = spaceTimeZ(lowerTape(ctx.n, ctx.tape), ctx.scope, [], { maxCols: 200 });
    if (!res) return { error: "tape too long (≤ 200 steps)" };
    return { charts: [{ kind: "heatmap", scale: "div", min: -1, max: 1, rows: qlabels(ctx.n), cols: stepLabels(res.numCols), values: res.z, title: "⟨Z⟩: rows qubits, cols steps" }] };
  },

  spacetimeS(ctx) {
    if (!ctx.tape.length) return { error: "the tape is empty" };
    const res = spaceTimeEntropy(lowerTape(ctx.n, ctx.tape), ctx.scope, [], { maxCols: 200 });
    if (!res) return { error: "tape too long (≤ 200 steps)" };
    return { charts: [{ kind: "heatmap", scale: "seq", min: 0, max: 1, rows: qlabels(ctx.n), cols: stepLabels(res.numCols), values: res.s, title: "S(qᵢ) bits: rows qubits, cols steps" }] };
  },

  asymmetry(ctx) {
    if (!ctx.tape.length) return { error: "the tape is empty" };
    const res = entanglementAsymmetrySweep(lowerTape(ctx.n, ctx.tape), ctx.scope, []);
    if (!res) return { error: "tape too long (≤ 96 steps)" };
    return {
      scalars: [{ label: "subsystem", value: `q0…q${res.subsystemSize - 1}` }],
      charts: [{ kind: "lines", x: res.asymmetry.map((_, i) => i + 1), xLabel: "step", yLabel: "ΔS (bits)", yMin: 0, series: [{ name: "ΔS_A", y: res.asymmetry }] }],
    };
  },

  lightcone(ctx, opts) {
    if (!ctx.tape.length) return { error: "the tape is empty" };
    const q = num("lightcone", "q", opts, ctx.n);
    const dir = num("lightcone", "dir", opts, ctx.n) === 1 ? "forward" : "backward";
    const circ = lowerTape(ctx.n, ctx.tape);
    const cone = computeLightCone(circ, q, dir);
    // Qubit × step map: 1 = gate inside the cone, 0.35 = gate outside, 0 = idle.
    const grid = Array.from({ length: ctx.n }, () => new Array<number>(ctx.tape.length).fill(0));
    for (const g of circ.gates) for (const x of [...g.controls, ...g.targets]) grid[x][g.column] = cone.has(g.id) ? 1 : 0.35;
    return {
      scalars: [{ label: `${dir} cone of q${q}`, value: `${cone.size} of ${circ.gates.length} gates` }],
      charts: [{ kind: "heatmap", scale: "seq", min: 0, max: 1, rows: qlabels(ctx.n), cols: stepLabels(ctx.tape.length), values: grid, codes: { 1: "in the cone", 0.35: "outside", 0: "idle" } }],
    };
  },
} satisfies Record<string, Run>);

Object.assign(RUNS, TOOL_RUNS, NOISE_RUNS, BENCH_RUNS);

export function runAnalysis(id: string, ctx: AnalysisContext, opts: Opts): AnalysisResult | Promise<AnalysisResult> {
  if (id === "__view") {
    try {
      return noisyView(ctx, opts);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
  const meta = ANALYSIS_BY_ID[id];
  const run = RUNS[id];
  if (!meta || !run) return { error: `unknown analysis ${id}` };
  if (ctx.n > meta.maxQubits) return { error: `needs n ≤ ${meta.maxQubits} (n = ${ctx.n})` };
  if (meta.minQubits && ctx.n < meta.minQubits) return { error: `needs n ≥ ${meta.minQubits}` };
  const fail = (e: unknown): AnalysisResult => ({ error: e instanceof Error ? e.message : String(e) });
  try {
    const out = run(ctx, opts);
    return out instanceof Promise ? out.catch(fail) : out;
  } catch (e) {
    return fail(e);
  }
}

/** For tests: every catalog id must have a compute function. */
export const RUN_IDS = Object.keys(RUNS);
export type { Chart };
