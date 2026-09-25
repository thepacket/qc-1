/**
 * LAB "Characterization & benchmarking": protocols run on the noise model
 * (src/noise/bench.ts), validated against Qiskit/Aer density matrices,
 * scipy fits and closed forms (fixture `bench`).
 */
import type { AnalysisContext, AnalysisResult, Opts } from "./types";
import { ANALYSIS_BY_ID, inputValue, pauliInput } from "./catalog";
import { classicalShadows, mirror, processTomography, quantumVolume, rb, repetitionExact, repetitionMonteCarlo, t1t2, unitarity, xeb, cliffordGroup, step } from "../noise/bench";
import type { NoiseModel } from "../noise/model";
import { mulberry32 } from "../sim/measure";
import { parsePauliSum } from "../sim/trotter";
import { pauliSumExpectation } from "../sim/expectation";
import { NONUNITARY, type Entry } from "../calc/steps";
import { qiskitLabel } from "../calc/order";

type Run = (ctx: AnalysisContext, opts: Opts) => AnalysisResult;
const num = (id: string, key: string, opts: Opts, n: number) => inputValue(ANALYSIS_BY_ID[id].inputs.find((s) => s.key === key)!, opts, n);
const needNoise = (ctx: AnalysisContext): NoiseModel => {
  if (!ctx.noise?.enabled) throw new Error("benchmarks measure the noise model: turn it on in LAB → Noise & error → Noise model");
  return ctx.noise;
};
const NOISE_NOTE = "Runs on the noise model (not on the circuit).";

export const BENCH_RUNS: Record<string, Run> = {
  rb(ctx, opts) {
    const m = needNoise(ctx);
    const gate = ["", "x", "h", "s", "sx"][num("rb", "interleave", opts, ctx.n)];
    const ref = rb(m, { sequences: num("rb", "sequences", opts, ctx.n) });
    const charts: AnalysisResult["charts"] = [{
      kind: "lines", x: ref.lengths, xLabel: "Cliffords m", yLabel: "P(0)", yMin: 0.4, yMax: 1,
      series: [{ name: "survival", y: ref.survival }, { name: "fit", y: ref.lengths.map((x) => ref.A * ref.p ** x + ref.B), dashed: true }],
    }];
    const shown = (x: number) => (Number.isNaN(x) ? "— (not identifiable)" : x);
    const scalars: AnalysisResult["scalars"] = [
      { label: "p", value: shown(ref.p) }, { label: "error per Clifford r = (1−p)/2", value: shown(ref.epc) },
      { label: "A, B", value: `${ref.A.toFixed(4)}, ${ref.B.toFixed(4)}` },
    ];
    if (gate) {
      const inter = rb(m, { sequences: num("rb", "sequences", opts, ctx.n), interleave: gate });
      scalars.push({ label: `interleaved ${gate.toUpperCase()}: p`, value: shown(inter.p) }, { label: `error of ${gate.toUpperCase()} = (1 − p_int/p)/2`, value: shown((1 - inter.p / ref.p) / 2) });
      charts[0] = { ...charts[0], kind: "lines", series: [...(charts[0] as { series: { name: string; y: number[] }[] }).series, { name: `interleaved ${gate}`, y: inter.survival }] } as typeof charts[0];
    }
    const flat = ref.identifiable ? [] : ref.p === 1
      ? ["The survival curve is flat, and the noise model puts no error on these gates: p = 1, r = 0."]
      : ["The survival curve is flat but the model has noise on these gates: the decay isn't identifiable (a flat curve can also come from a channel that resets the qubit)."];
    return { scalars, charts, notes: [NOISE_NOTE, "Single-qubit Cliffords (24, from H and S); P(m) = A·pᵐ + B fitted with B free. The interleaved gate runs as itself, with its own noise.", ...flat] };
  },

  unitarity(ctx) {
    const u = unitarity(needNoise(ctx));
    return {
      scalars: [{ label: "unitarity u", value: Number.isNaN(u.u) ? "— (flat purity curve: not identifiable)" : u.u }],
      charts: [{ kind: "lines", x: u.lengths, xLabel: "Cliffords m", yLabel: "|Bloch|²", yMin: 0, yMax: 1, series: [{ name: "purity", y: u.purity }] }],
      notes: [NOISE_NOTE, "Mean squared Bloch length after m random Cliffords, fitted as A·uᵐ⁻¹ + B (Wallman et al. 2015).",
        "For one channel, u ≥ p² (Cauchy–Schwarz on the unital block), with equality for depolarizing noise: u close to p² means incoherent (stochastic) error, u well above p² means a coherent part. u = 1 is a unitary channel, including no error at all. Compare with p from RB only when both come from the same gate set and noise.",
        ...(u.identifiable ? [] : u.u === 1
          ? ["The purity curve is flat and the noise model puts no error on these gates: u = 1."]
          : ["The purity curve is flat but the model has noise on these gates: u isn't identifiable (a reset channel keeps the purity at 1 while its unitarity is 0)."])],
    };
  },

  qv(ctx, opts) {
    const m = needNoise(ctx);
    const max = num("qv", "width", opts, ctx.n);
    const r = quantumVolume(m, { widths: Array.from({ length: max - 1 }, (_, i) => i + 2), circuits: num("qv", "circuits", opts, ctx.n) });
    return {
      scalars: [{ label: "quantum volume", value: r.qv }],
      charts: [{ kind: "table", headers: ["width", "heavy output", "lower 2σ", ""], rows: r.rows.map((x) => [x.width, x.mean, x.lower, x.pass ? "pass" : "fail"]) }],
      notes: [NOISE_NOTE, "Square circuits of Haar SU(4) blocks (as native gates by KAK); pass when the heavy-output probability is above 2/3 with 2σ confidence. Ideal: (1 + ln 2)/2 ≈ 0.85."],
    };
  },

  xeb(ctx, opts) {
    const r = xeb(needNoise(ctx), { n: num("xeb", "qubits", opts, ctx.n) });
    return {
      scalars: [{ label: "fidelity per cycle", value: r.perCycle }],
      charts: [{ kind: "lines", x: r.depths, xLabel: "cycles", yLabel: "linear XEB", yMin: 0, yMax: 1, series: [{ name: "F", y: r.fidelity }] }],
      notes: [NOISE_NOTE, "Random √X/√Y/T layers with brickwork CZ; F = Σ(p−1/D)(q−1/D)/Σ(q−1/D)² from the exact distributions."],
    };
  },

  mirror(ctx) {
    const r = mirror(needNoise(ctx));
    return {
      charts: [{ kind: "heatmap", scale: "seq", min: 0, max: 1, rows: r.widths.map((w) => `${w}q`), cols: r.depths.map(String), values: r.success, title: "success P(0…0): rows width, columns depth" }],
      notes: [NOISE_NOTE, "Random Clifford layers followed by their exact inverse."],
    };
  },

  t1t2(ctx) {
    const r = t1t2(needNoise(ctx));
    const f = (x: number) => (Number.isNaN(x) ? "— (not identifiable)" : Number.isFinite(x) ? x : "∞ (no decay)");
    return {
      scalars: [{ label: "T1", value: f(r.T1), unit: "gates" }, { label: "T2* (Ramsey)", value: f(r.T2), unit: "gates" }, { label: "T2 (echo)", value: f(r.T2echo), unit: "gates" }],
      charts: [{ kind: "lines", x: r.delays, xLabel: "idle gates", yLabel: "P", yMin: 0, yMax: 1, series: [{ name: "T1: P(1)", y: r.t1 }, { name: "Ramsey: P(0)", y: r.ramsey }, { name: "echo: P(1)", y: r.echo }] }],
      notes: [NOISE_NOTE, "Idle identity gates carry the per-gate noise; times are in units of one gate."],
    };
  },

  qec(ctx, opts) {
    const shots = num("qec", "shots", opts, ctx.n);
    const ps = Array.from({ length: 13 }, (_, i) => (i / 12) * 0.6);
    const ds = [3, 5, 7];
    const rng = mulberry32(0x9ec0);
    return {
      charts: [{
        kind: "lines", x: ps, xLabel: "physical flip p", yLabel: "logical error", yMin: 0, yMax: 1,
        series: ds.flatMap((d) => [
          { name: `d=${d} exact`, y: ps.map((p) => repetitionExact(d, p)) },
          { name: `d=${d} decoded`, y: ps.map((p) => repetitionMonteCarlo(d, p, shots, rng)), dashed: true },
        ]),
      }],
      notes: ["Bit-flip repetition code with a minimum-weight lookup decoder; curves cross at the threshold p = ½."],
    };
  },

  shadows(ctx, opts) {
    const terms = parsePauliSum(pauliInput(opts, "obs", ctx.n));
    if (terms[0].paulis.length !== ctx.n) throw new Error(`Pauli strings need ${ctx.n} letters`);
    const N = num("shadows", "snapshots", opts, ctx.n);
    const sh = classicalShadows(ctx.n, ctx.state, N);
    const rows = terms.map((t) => {
      const e = sh.estimate(t.paulis);
      return [qiskitLabel(t.paulis), t.coefficient, e.mean, e.stderr, pauliSumExpectation(ctx.state, ctx.n, [{ coefficient: 1, paulis: t.paulis }])];
    });
    const H = sh.estimateSum(terms); // per-snapshot Σ hₖ vₖ: covariances between terms included
    return {
      scalars: [{ label: "⟨H⟩ from shadows", value: `${H.mean.toFixed(4)} ± ${H.stderr.toFixed(4)}` }, { label: "exact ⟨H⟩", value: pauliSumExpectation(ctx.state, ctx.n, terms) }],
      charts: [{ kind: "table", headers: ["P", "h", "estimate", "±", "exact"], rows }],
      notes: [`${N} random-Pauli snapshots of the current (ideal) state; each weight-k Pauli costs about 3ᵏ more snapshots.`],
    };
  },

  tomography(ctx, opts) {
    if (ctx.tape.some((e) => e.some((s) => NONUNITARY.has(s.gateId) || s.condition))) throw new Error("process tomography needs a unitary circuit");
    const noisy = num("tomography", "channel", opts, ctx.n) === 1;
    if (noisy) needNoise(ctx);
    const R = processTomography(ctx.n, ctx.tape, noisy ? ctx.noise! : null, ctx.scope);
    // Qiskit's Pauli basis order (digit q is qubit q), labels as Qiskit writes them (q0 rightmost).
    const labels = Array.from({ length: 4 ** ctx.n }, (_, k) => Array.from({ length: ctx.n }, (_, q) => "IXYZ"[(k >> (2 * (ctx.n - 1 - q))) & 3]).join(""));
    const ideal = processTomography(ctx.n, ctx.tape, null, ctx.scope);
    const d = 1 << ctx.n;
    // Process fidelity F = Tr(R_ideal^T R)/d², average gate fidelity (dF + 1)/(d + 1).
    let tr = 0;
    for (let i = 0; i < R.length; i++) for (let j = 0; j < R.length; j++) tr += ideal[i][j] * R[i][j];
    const Fp = tr / (d * d);
    return {
      scalars: [{ label: "process fidelity", value: Fp }, { label: "average gate fidelity", value: (d * Fp + 1) / (d + 1) }],
      charts: [{ kind: "heatmap", scale: "div", min: -1, max: 1, rows: labels, cols: labels, values: R, title: "Pauli transfer matrix R_ij (row: output, column: input)" }],
      notes: ["Inputs |0⟩, |1⟩, |+⟩, |+i⟩ per qubit (prepared ideally: the channel is the circuit's), every Pauli read out, linear inversion (exact expectation values)."],
    };
  },

  randclifford(ctx, opts) {
    const depth = num("randclifford", "depth", opts, ctx.n);
    const rng = mulberry32((Number(opts.seed) || 0) + 0xc11f);
    const G = cliffordGroup();
    const tape: Entry[] = [];
    for (let d = 0; d < depth; d++) {
      for (let q = 0; q < ctx.n; q++) for (const g of G.gates[Math.floor(rng() * 24) % 24]) tape.push([step(g, [q])]);
      for (let q = d % 2; q + 1 < ctx.n; q += 2) tape.push([step("x", [q + 1], [q])]);
    }
    return {
      scalars: [{ label: "gates", value: tape.length }],
      proposal: { label: "APPLY · replace the circuit", n: ctx.n, tape, verified: true, check: "a random Clifford circuit (H, S, CX layers)" },
      notes: ["Random single-qubit Cliffords on every qubit, then a brickwork CX layer, repeated. Re-run for another draw."],
    };
  },
};
