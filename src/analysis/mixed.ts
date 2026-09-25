import type { AnalysisContext } from "./types";
import { densityOf, partialTrace } from "./noiseRuns";
import { REDUCED, type MeasuredState } from "../sim/density";

export const MIXED_FULL = new Set(["expectation", "totalcorr", "coherence"]);

/** Keep the ensemble available to routines that request reduced matrices. */
export function mixedContext(ctx: AnalysisContext) {
  if (ctx.n > 8) throw new Error("Mixed-state analysis currently supports up to 8 qubits. Use Hardware experiment for supported local tomography panels at larger sizes.");
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
