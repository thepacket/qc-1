/// <reference lib="webworker" />
/** One chunk of noisy trajectories (parallel.ts), as sums; the buffers are transferred back. */
import { trajectorySums } from "./sim";
import { setCustomGates } from "../calc/custom";
import type { TrajJob } from "./parallel";

self.onmessage = (e: MessageEvent<TrajJob>) => {
  const { n, tape, scope, m, T, seed, gates } = e.data;
  setCustomGates(gates);
  const sums = trajectorySums(n, tape, scope, m, T, seed);
  (self as DedicatedWorkerGlobalScope).postMessage(sums, [sums.probs.buffer, sums.bloch.buffer]);
};
