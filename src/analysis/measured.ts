/**
 * LAB panels on a periodic run's measurements (Hardware experiment), as on hardware.
 * Each panel sees an estimate built from a measurement record:
 *
 *   FROM_SHOTS       the Z experiment (the SHOTS sample): Σ √fᵢ |i⟩;
 *   FROM_LOCAL       reduced density matrices of the qubits the panel asks for,
 *                    measured: up to TOMO_MAX qubits the partial traces of the
 *                    run's state tomography (the mixed ρ̂), above that local
 *                    tomography of each subset (3ᵏ settings × N shots);
 *   FROM_TOMOGRAPHY  the reconstructed state (the leading eigenvector of ρ̂).
 *
 * Every experiment runs on the device: the noise model's readout errors and
 * each qubit's noisy basis changes (noise/sim.ts measurementDevice). With
 * `mitigate`, the readout confusion is undone on every count before
 * estimation (quasi-counts). Error bars: the counts are resampled
 * (multinomially, B times within a time budget) and the panel re-run; each
 * numeric scalar gets the replicates' standard deviation.
 */
import type { AnalysisContext, AnalysisRequest, AnalysisResult, Opts, Scalar } from "./types";
import { FROM_LOCAL, FROM_SHOTS } from "./catalog";
import { sampleState } from "../calc/analysis";
import { EXP, sampleStateVector, shotRng, stateTomography } from "../calc/estimate";
import { circuitCounts, circuitTomography, needsReplay } from "../calc/experiments";
import {
  drawCounts, IDEAL_DEVICE, linearInversion, mitigateCounts, physical, rhoProbs, rhoProbsNoisy, tomography, TOMO_MAX, type Device,
} from "../calc/tomography";
import { densityOk, measurementDevice, noisyShots, runTrajectories } from "../noise/sim";
import { noisyStatsParallel } from "../noise/parallel";
import { isIdeal } from "../noise/model";
import { reducedDensityMatrix, REDUCED, type Complex, type MeasuredState } from "../sim/density";
import { densityOf, partialTrace } from "./noiseRuns";

type Sample = NonNullable<AnalysisRequest["sample"]>;
type Run = (id: string, ctx: AnalysisContext, opts: Opts) => AnalysisResult | Promise<AnalysisResult>;
type Counts = Map<number, number>;

/** At most this many bootstrap replicates, and no more than this much time (ms) on them. */
const BOOT_MAX = 30, BOOT_MS = 600;

const toComplex = (rho: Float64Array, d: number): Complex[][] =>
  Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => ({ re: rho[2 * (i * d + j)], im: rho[2 * (i * d + j) + 1] })));
const fromComplex = (m: Complex[][]): Float64Array => {
  const d = m.length, out = new Float64Array(2 * d * d);
  m.forEach((row, i) => row.forEach((z, j) => { out[2 * (i * d + j)] = z.re; out[2 * (i * d + j) + 1] = z.im; }));
  return out;
};

/** N draws from the counts' own frequencies: one bootstrap replicate of an experiment. */
function resample(counts: Counts, shots: number, rng: () => number): Counts {
  const keys = [...counts.keys()];
  const probs = Float64Array.from(keys, (k) => Math.max(0, counts.get(k)!));
  const drawn = drawCounts(probs, shots, rng);
  return new Map([...drawn].map(([i, c]) => [keys[i], c]));
}

/** A stable number for a qubit subset (its seeds). */
const subsetKey = (kept: number[]) => kept.reduce((h, q) => (Math.imul(h ^ (q + 1), 0x01000193) >>> 0), 0x811c9dc5) % 1_000_003;

/** The device restricted to some qubits (their readout and basis changes, in that order). */
const onQubits = (device: Device, qs: number[]): Device => ({
  readout: device.readout.length ? qs.map((q) => device.readout[q]) : [],
  superops: device.superops && qs.map((q) => device.superops![q]),
});

/**
 * One path's measurement record and its estimator: `estimate(replicate)`
 * returns the state the panel sees, from the original counts (replicate 0)
 * or from bootstrap replicate b's resampled counts.
 */
type Path = { estimate: (b: number) => Float64Array | MeasuredState; note: string };

async function zPath(ctx: AnalysisContext, sample: Sample, noisy: boolean, device: Device): Promise<Path> {
  const { n } = ctx, { shots, seed } = sample;
  const counts = noisy
    ? noisyShots(n, (await noisyStatsParallel(n, ctx.tape, ctx.scope, ctx.noise!)).probs, ctx.noise!, shots, 0x5407 + seed)
    : needsReplay(ctx.tape)
      ? circuitCounts(n, ctx.tape, ctx.scope, Array.from({ length: n }, (_, q) => q), Array(n).fill(2), shots, shotRng(seed))
      : sampleState(ctx.state, shots, shotRng(seed));
  const replicate = (b: number) => (b ? resample(counts, shots, shotRng(seed, 900_000 + b)) : counts);
  return {
    estimate: (b) => {
      let c = replicate(b);
      if (sample.mitigate && device.readout.length) {
        // Quasi-frequencies, clipped and renormalised: the panel needs a distribution.
        const q = mitigateCounts(c, n, device.readout);
        const total = [...q.values()].reduce((a, v) => a + Math.max(0, v), 0) || 1;
        c = new Map([...q].filter(([, v]) => v > 0).map(([i, v]) => [i, (v / total) * shots]));
      }
      return sampleStateVector(n, c, shots);
    },
    note: `Estimated from ${shots.toLocaleString()} shots${noisy ? " of the noisy circuit" : ""} (Hardware experiment): the sample's Z-basis frequencies, as on hardware.`,
  };
}

/** Tomography counts → physical ρ (mitigated first if asked). */
function reconstruct(k: number, counts: Counts[], shots: number, sample: Sample, device: Device) {
  const used = sample.mitigate && device.readout.length ? counts.map((c) => mitigateCounts(c, k, device.readout)) : counts;
  return physical(linearInversion(k, used, shots), 1 << k);
}

function fullTomography(ctx: AnalysisContext, sample: Sample, noisy: boolean, device: Device) {
  if (!noisy && needsReplay(ctx.tape)) return circuitTomography(ctx.n, ctx.tape, ctx.scope, Array.from({ length: ctx.n }, (_, q) => q), sample.shots, k => shotRng(sample.seed, EXP.TOMO + k));
  const source = noisy ? { rho: densityOf(ctx, ctx.noise!).rho } : { state: ctx.state };
  return stateTomography(ctx.n, sample.shots, sample.seed, source, device, undefined, !!sample.mitigate)!;
}

/** Work budget (amplitude operations) for trajectory-averaged reduced density matrices, and the fewest trajectories worth showing. */
const LOCAL_WORK = 4e8, LOCAL_MIN_T = 16;

/**
 * The noisy reduced ρ of each subset, averaged over trajectories (circuits too
 * big for the model's density matrix: n > 10, or measuring above 8 qubits),
 * with as many trajectories as the work budget allows. Throws when that's too
 * few to be worth showing.
 */
function trajectoryReduced(ctx: AnalysisContext, subsets: number[][]): { rho: Map<string, Float64Array>; T: number } {
  const { n } = ctx, m = ctx.noise!, dim = 1 << n;
  const steps = ctx.tape.flat().length;
  const perT = dim * (steps + subsets.reduce((a, k) => a + 4 ** k.length, 0));
  const T = Math.min(m.trajectories, Math.floor(LOCAL_WORK / perT));
  if (T < LOCAL_MIN_T) {
    throw new Error(`Too large to measure with noise here: ${subsets.length} qubit subsets on ${n} qubits leave ${T} trajectories in the work budget (${LOCAL_MIN_T} needed). Turn noise off, or switch to Simulation.`);
  }
  const acc = new Map(subsets.map((k) => [k.join(","), new Float64Array(2 * 4 ** k.length)]));
  runTrajectories(n, ctx.tape, ctx.scope, m, (st) => {
    for (const k of subsets) {
      const r = reducedDensityMatrix(st, n, k), a = acc.get(k.join(","))!, d = 1 << k.length;
      for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) { a[2 * (i * d + j)] += r[i][j].re / T; a[2 * (i * d + j) + 1] += r[i][j].im / T; }
    }
  }, { trajectories: T, seed: 0x10ca1 });
  return { rho: acc, T };
}

/** Local panels: measured reduced density matrices of the subsets they ask for. */
async function localPath(id: string, ctx: AnalysisContext, opts: Opts, run: Run, sample: Sample, noisy: boolean, device: Device): Promise<Path> {
  const { n } = ctx, { shots, seed } = sample;
  if (n <= TOMO_MAX) {
    const tomo = fullTomography(ctx, sample, noisy, device);
    const S = tomo.settings;
    const cache = new Map<number, Float64Array>();
    const rhoOf = (b: number) => {
      if (!cache.has(b)) cache.set(b, b ? reconstruct(n, tomo.counts.map((c, k) => resample(c, shots, shotRng(seed, 1_000_000 * b + k))), shots, sample, device).rho : reconstruct(n, tomo.counts, shots, sample, device).rho);
      return cache.get(b)!;
    };
    return {
      estimate: (b) => {
        const st = new Float64Array(2 << n) as MeasuredState;
        st[REDUCED] = (kept) => toComplex(partialTrace(rhoOf(b), n, kept), 1 << kept.length);
        return st;
      },
      note: `Measured by state tomography (Hardware experiment): ${S.toLocaleString()} Pauli settings × ${shots.toLocaleString()} shots${noisy ? " of the noisy circuit" : ""}; this panel sees the reconstructed mixed ρ̂ (its reduced density matrices).`,
    };
  }
  // Larger registers: tomography of each subset, from its exact reduced ρ. Noisy: the model's density matrix when
  // it fits, else an average over trajectories of the subsets the panel asks for (found by a first, recording run).
  let noisyRho: Float64Array | null = null;
  let traj: { rho: Map<string, Float64Array>; T: number } | null = null;
  // densityOf covers unitary circuits up to 10 qubits and measured ones up to 8; beyond, trajectories.
  if (noisy && !densityOk(n, ctx.tape) && n > 8) {
    const subsets: number[][] = [];
    const recorder = new Float64Array(2 << n) as MeasuredState;
    recorder[REDUCED] = (kept) => {
      if (!subsets.some((k) => k.join(",") === kept.join(","))) subsets.push([...kept]);
      const d = 1 << kept.length;
      return Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => ({ re: i === j ? 1 / d : 0, im: 0 })));
    };
    await run(id, { ...ctx, state: recorder }, opts);
    traj = trajectoryReduced(ctx, subsets);
  }
  const exactReduced = (kept: number[]): Float64Array => {
    if (!noisy) return fromComplex(reducedDensityMatrix(ctx.state, n, kept));
    if (traj) {
      const r = traj.rho.get(kept.join(","));
      if (!r) throw new Error(`q${kept.join(", q")}: not measured in this run`);
      return r;
    }
    noisyRho ??= densityOf(ctx, ctx.noise!).rho;
    return partialTrace(noisyRho, n, kept);
  };
  const counts = new Map<number, Counts[]>();
  const measure = (kept: number[]) => {
    const key = subsetKey(kept);
    if (!counts.has(key)) {
      if (!noisy && needsReplay(ctx.tape)) {
        counts.set(key, circuitTomography(n, ctx.tape, ctx.scope, kept, shots, j => shotRng(seed, EXP.TOMO + 1000 * key + j)).counts);
        return counts.get(key)!;
      }
      const k = kept.length, rho = exactReduced(kept), dev = onQubits(device, kept);
      const probsOf = dev.superops ? (s: (0 | 1 | 2)[]) => rhoProbsNoisy(rho, k, s, dev.superops!) : (s: (0 | 1 | 2)[]) => rhoProbs(rho, k, s);
      counts.set(key, tomography(k, shots, probsOf, (j) => shotRng(seed, EXP.TOMO + 1000 * key + j), dev.readout).counts);
    }
    return counts.get(key)!;
  };
  return {
    estimate: (b) => {
      const st = new Float64Array(2 << n) as MeasuredState;
      st[REDUCED] = (kept) => {
        const key = subsetKey(kept), c = measure(kept);
        const used = b ? c.map((x, j) => resample(x, shots, shotRng(seed, 1_000_000 * b + 1000 * key + j))) : c;
        return toComplex(reconstruct(kept.length, used, shots, sample, onQubits(device, kept)).rho, 1 << kept.length);
      };
      return st;
    },
    get note() {
      return `Measured by local tomography (Hardware experiment): each qubit subset the panel needs, 3ᵏ Pauli settings × ${shots.toLocaleString()} shots${noisy ? ` of the noisy circuit (${traj ? `its state from ${traj.T} noise trajectories, ` : ""}the basis changes with those qubits' own noise, no crosstalk to others)` : ""}; the panel sees the reconstructed mixed ρ of each subset.`;
    },
  };
}

function statePath(ctx: AnalysisContext, sample: Sample, noisy: boolean, device: Device): Path {
  const { n } = ctx, { shots, seed } = sample;
  const tomo = fullTomography(ctx, sample, noisy, device);
  const lead = (b: number) => {
    if (!b && !sample.mitigate) return tomo.state;
    const counts = b ? tomo.counts.map((c, k) => resample(c, shots, shotRng(seed, 1_000_000 * b + k))) : tomo.counts;
    const { vectors } = reconstruct(n, counts, shots, sample, device);
    const v = vectors[0];
    let big = 0;
    v.forEach((z, i) => { if (z.re ** 2 + z.im ** 2 > v[big].re ** 2 + v[big].im ** 2) big = i; });
    const m = Math.hypot(v[big].re, v[big].im) || 1, cr = v[big].re / m, ci = -v[big].im / m;
    const st = new Float64Array(2 * v.length);
    v.forEach((z, i) => { st[2 * i] = z.re * cr - z.im * ci; st[2 * i + 1] = z.re * ci + z.im * cr; });
    return st;
  };
  return {
    estimate: lead,
    note: `Reconstructed by state tomography (Hardware experiment): ${tomo.settings.toLocaleString()} Pauli settings × ${shots.toLocaleString()} shots${noisy ? " of the noisy circuit" : ""}; this panel sees the leading eigenvector of ρ̂ (weight λ₁ = ${tomo.lambda.toFixed(3)}).`,
  };
}

/** Run panel `id` on the run's measurements, with bootstrap error bars on its numeric scalars. */
export async function measuredRun(id: string, ctx: AnalysisContext, opts: Opts, sample: Sample, run: Run): Promise<AnalysisResult> {
  const local = FROM_LOCAL.has(id) || id === "expectation", z = FROM_SHOTS.has(id);
  if (!z && ctx.n > TOMO_MAX && (!local || id === "expectation")) {
    return { error: `Not measurable at this size with shots: state tomography needs 3ⁿ settings (${(3 ** ctx.n).toLocaleString()} at n = ${ctx.n}); QC-1 reconstructs up to ${TOMO_MAX} qubits. Switch to Simulation for the direct result.` };
  }
  try {
    const noisy = !!ctx.noise && !isIdeal(ctx.noise);
    // A pure-state visualization can explicitly show a principal component;
    // a scientific observable must not silently substitute it for a mixture.
    if (!local && !z && (noisy || needsReplay(ctx.tape)) && !["statevector", "ampphase", "qsphere"].includes(id)) {
      return { error: "This analysis requires a pure state and cannot yet use the measured mixed density matrix. Use a mixed-state analysis such as Expectation value or Reduced density matrix." };
    }
    const device = noisy ? measurementDevice(ctx.noise!, ctx.n) : IDEAL_DEVICE;
    const path = z ? await zPath(ctx, sample, noisy, device) : local ? await localPath(id, ctx, opts, run, sample, noisy, device) : statePath(ctx, sample, noisy, device);
    const out = await run(id, { ...ctx, state: path.estimate(0) }, opts);
    if (out.error) return out;
    // Bootstrap: resample every experiment's counts, re-run, and take each numeric scalar's spread.
    const values = new Map<string, number[]>();
    const t0 = Date.now();
    let B = 0;
    for (let b = 1; b <= BOOT_MAX && (b <= 5 || Date.now() - t0 < BOOT_MS); b++) {
      const r = await run(id, { ...ctx, state: path.estimate(b) }, opts);
      if (r.error) continue;
      for (const s of r.scalars ?? []) if (typeof s.value === "number" && Number.isFinite(s.value)) (values.get(s.label) ?? values.set(s.label, []).get(s.label)!).push(s.value);
      B++;
    }
    const sd = (xs: number[]) => { const m = xs.reduce((a, v) => a + v, 0) / xs.length; return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
    const scalars: Scalar[] | undefined = out.scalars?.map((s) => {
      const xs = values.get(s.label);
      return typeof s.value === "number" && xs && xs.length >= 2 ? { ...s, err: sd(xs) } : s;
    });
    const notes = [
      path.note,
      ...(B ? [`± is the bootstrap spread (${B} resamplings of the counts)${sample.mitigate && noisy ? "; readout errors mitigated (the confusion matrix undone on every count)" : ""}. Charts show the estimate only.`] : []),
      ...(out.notes ?? []),
    ];
    return { ...out, scalars, notes, provenance: {
      method: z ? "Sampled Z measurements" : local && ctx.n > TOMO_MAX ? "Local state tomography" : "State tomography",
      detail: `${shotsLabel(sample.shots)}${B ? ` · uncertainty from ${B} bootstrap resamplings` : ""}${noisy ? " · noise model included" : " · ideal circuit"}${sample.mitigate && noisy ? " · readout mitigated" : ""}`,
    } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const shotsLabel = (shots: number) => `${shots.toLocaleString()} shots per measurement setting`;
