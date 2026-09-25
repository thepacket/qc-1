import { trajectoryReduced } from "../noise/reduced";
import type { AnalysisContext, AnalysisResult, Opts } from "./types";
import { densityOf, partialTrace } from "./noiseRuns";
import { REDUCED, type MeasuredState } from "../sim/density";

export const MIXED_FULL = new Set(["expectation", "totalcorr", "coherence", "qfi"]);

/** Keep the ensemble available to routines that request reduced matrices. */
export function mixedContext(ctx: AnalysisContext) {
  if (ctx.n > 8) throw new Error("Mixed-state analysis currently supports up to 8 qubits. Use a local-density panel for larger circuits.");
  const { rho, method } = densityOf(ctx, ctx.noise!);
  const state = new Float64Array(2 << ctx.n) as MeasuredState;
  state[REDUCED] = kept => {
    const r = partialTrace(rho, ctx.n, kept), d = 2 ** kept.length;
    return Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => ({ re: r[2 * (i * d + j)], im: r[2 * (i * d + j) + 1] })));
  };
  // Probability-only analyses can use the diagonal, without treating it as a pure state.
  for (let i = 0; i < 2 ** ctx.n; i++) state[2 * i] = Math.sqrt(Math.max(0, rho[2 * (i * 2 ** ctx.n + i)]));
  return { ctx: { ...ctx, state }, method };
}

/** Discover only the subsets a local analysis needs, then average those matrices. */
export async function localMixedContext(ctx: AnalysisContext, id: string, opts: Opts,
  run: (id: string, ctx: AnalysisContext, opts: Opts) => AnalysisResult | Promise<AnalysisResult>) {
  if (ctx.n > 20) throw new Error("Local mixed-state analysis supports up to 20 qubits within the work budget.");
  const subsets: number[][] = [];
  const state = new Float64Array(2 << ctx.n) as MeasuredState;
  state[REDUCED] = kept => {
    if (kept.length > 6) throw new Error("Keep at most 6 qubits for local mixed-state analysis.");
    if (!subsets.some(k => k.join(",") === kept.join(","))) subsets.push([...kept]);
    const d = 2 ** kept.length;
    return Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => ({ re: i === j ? 1 / d : 0, im: 0 })));
  };
  const probe = await run(id, { ...ctx, state }, opts);
  if (probe.error) throw new Error(probe.error);
  if (!subsets.length) throw new Error("This panel does not support local density matrices.");
  const { rho, T } = trajectoryReduced(ctx, subsets);
  state[REDUCED] = kept => {
    const r = rho.get(kept.join(","));
    if (!r) throw new Error("The analysis requested an unprepared qubit subset.");
    const d = 2 ** kept.length;
    return Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => ({ re: r[2 * (i * d + j)], im: r[2 * (i * d + j) + 1] })));
  };
  return { ctx: { ...ctx, state }, method: `${T} trajectories · local density matrices · approximate; trajectory uncertainty is not included in error bars` };
}
