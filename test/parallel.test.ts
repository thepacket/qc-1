import { describe, test, expect } from "vitest";
import { mergeSums, noisyStats, trajectoryChunks, trajectorySums } from "../src/noise/sim";
import { noisyStatsParallel } from "../src/noise/parallel";
import { sanitiseNoise } from "../src/noise/model";
import { randomTape, rng } from "../validation/cases/tapes";
import type { Entry } from "../src/calc/steps";

const m = sanitiseNoise({ enabled: true, p1: 0.02, p2: 0.05, ad: 0.01, pd: 0.01, readout: 0.02, trajectories: 64 });
// A measurement makes the density path inapplicable: trajectories.
const tape: Entry[] = [...randomTape(rng(3), 4, 10), [{ id: "m", gateId: "measure", column: 0, targets: [1], controls: [], clbits: [], params: [] }]];

describe("trajectory chunks", () => {
  test("chunks split T exactly, with distinct seeds, independent of hardware", () => {
    const c = trajectoryChunks(66, 5);
    expect(c.map((x) => x.T)).toEqual([9, 9, 8, 8, 8, 8, 8, 8]);
    expect(new Set(c.map((x) => x.seed)).size).toBe(8);
    expect(trajectoryChunks(2, 5)).toHaveLength(2);
  });

  test("noisyStats = the merge of its chunks, run in any order", () => {
    const whole = noisyStats(4, tape, {}, m);
    const chunks = trajectoryChunks(64, 0x1eaf).map((c) => trajectorySums(4, tape, {}, m, c.T, c.seed));
    const merged = mergeSums(4, chunks);
    expect([...merged.probs]).toEqual([...whole.probs]);
    expect(merged.bloch).toEqual(whole.bloch);
    expect(whole.trajectories).toBe(64);
  });

  test("without workers (tests, old browsers) the parallel entry point gives the same numbers", async () => {
    const a = noisyStats(4, tape, {}, m), b = await noisyStatsParallel(4, tape, {}, m);
    expect([...b.probs]).toEqual([...a.probs]);
  });
});
