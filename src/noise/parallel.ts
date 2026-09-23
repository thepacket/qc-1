/**
 * Noisy statistics on several cores: the trajectory chunks of sim.ts
 * (TRAJ_CHUNKS, fixed seeds) run on up to hardwareConcurrency − 1 workers
 * (trajWorker.ts) and merge in chunk order, so the result is identical to
 * noisyStats on one core. Small jobs, the density-matrix path, and any
 * environment without workers (or a worker failure) run in place.
 */
import { densityOk, mergeSums, noisyStats, trajectoryChunks, trajectorySums, type NoisyStats, type TrajSums } from "./sim";
import type { NoiseModel } from "./model";
import type { Entry, Scope } from "../calc/steps";
import { customGates } from "../calc/custom";

/** Below this many amplitude-updates (2ⁿ × trajectories × steps) a pool costs more than it saves. */
const PARALLEL_MIN = 2 ** 22;

export type TrajJob = { n: number; tape: Entry[]; scope: Scope; m: NoiseModel; T: number; seed: number; gates: ReturnType<typeof customGates> };

export async function noisyStatsParallel(n: number, tape: Entry[], scope: Scope, m: NoiseModel, opts: { trajectories?: number; seed?: number } = {}): Promise<NoisyStats> {
  const T = Math.max(1, opts.trajectories ?? m.trajectories);
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 2 : 1;
  const work = 2 ** n * T * Math.max(1, tape.length);
  if (densityOk(n, tape) || typeof Worker === "undefined" || cores < 3 || work < PARALLEL_MIN) return noisyStats(n, tape, scope, m, opts);
  const chunks = trajectoryChunks(T, opts.seed ?? 0x1eaf);
  const k = Math.min(chunks.length, cores - 1);
  const workers: Worker[] = [];
  try {
    for (let i = 0; i < k; i++) workers.push(new Worker(new URL("./trajWorker.ts", import.meta.url), { type: "module" }));
    const gates = customGates();
    const parts: TrajSums[] = new Array(chunks.length);
    let next = 0;
    await Promise.all(workers.map((w) => new Promise<void>((resolve, reject) => {
      const take = () => {
        if (next >= chunks.length) return resolve();
        const i = next++;
        w.onmessage = (e: MessageEvent<TrajSums>) => { parts[i] = e.data; take(); };
        w.onerror = (e) => reject(e);
        w.postMessage({ n, tape, scope, m, T: chunks[i].T, seed: chunks[i].seed, gates } satisfies TrajJob);
      };
      take();
    })));
    return { ...mergeSums(n, parts), workers: k };
  } catch {
    // No nested workers here (or one failed): the same chunks, in place.
    return mergeSums(n, chunks.map((c) => trajectorySums(n, tape, scope, m, c.T, c.seed)));
  } finally {
    for (const w of workers) w.terminate();
  }
}
