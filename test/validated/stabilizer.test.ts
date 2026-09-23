import { describe, test, expect } from "vitest";
import { compute } from "../../validation/cases/groups/stabilizer";
import type { Entry } from "../../src/calc/steps";
import { loadFixture } from "./fixtures";

// References: Qiskit StabilizerState of each exported circuit (n up to 200),
// post-selected statevectors for measured tapes (validation/ref/g_stabilizer.py).
const fx = loadFixture<{ n: number; tape: Entry[]; generators: string[]; cbits?: number[] }>("stabilizer");

describe(`stabilizer mode (vs ${fx.meta.reference})`, () => {
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const mine = compute({ id: c.id, n: c.n, tape: c.tape });
    expect(mine.generators).toEqual(c.generators);
    if (c.cbits) expect(mine.cbits).toEqual(c.cbits);
    expect(mine.notes).toEqual([]);
  });
});
