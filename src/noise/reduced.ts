import type { AnalysisContext } from "../analysis/types";
import { reducedDensityMatrix } from "../sim/density";
import { runTrajectories } from "./sim";

/** Work budget (amplitude operations) for trajectory-averaged reduced density matrices, and the fewest trajectories worth showing. */
const LOCAL_WORK = 4e8, LOCAL_MIN_T = 16;

/**
 * The noisy reduced ρ of each subset, averaged over trajectories (circuits too
 * big for the model's density matrix: n > 10, or measuring above 8 qubits),
 * with as many trajectories as the work budget allows. Throws when that's too
 * few to be worth showing.
 */
export function trajectoryReduced(ctx: AnalysisContext, subsets: number[][]): { rho: Map<string, Float64Array>; T: number } {
  const { n } = ctx, m = ctx.noise!, dim = 1 << n;
  if (n > 20 || subsets.some(k => k.length > 6)) throw new Error("Local mixed-state calculations support up to 20 circuit qubits and 6 kept qubits within the work budget.");
  const steps = ctx.tape.flat().length;
  const perT = dim * (steps + subsets.reduce((a, k) => a + 4 ** k.length, 0));
  const T = Math.min(m.trajectories, Math.floor(LOCAL_WORK / perT));
  if (T < LOCAL_MIN_T) {
    throw new Error(`Too large to measure with noise here: ${subsets.length} qubit subsets on ${n} qubits leave ${T} trajectories in the work budget (${LOCAL_MIN_T} needed). Reduce the circuit or the kept subset, or increase trajectories if the configured count is below the minimum.`);
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

