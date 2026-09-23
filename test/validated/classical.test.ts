import { describe, test, expect } from "vitest";
import { compute } from "../../validation/cases/groups/classical";
import type { Entry } from "../../src/calc/steps";
import { loadFixture } from "./fixtures";

// References: Qiskit's import of the export (if_else) run by an independent
// interpreter with QC-1's recorded outcomes (validation/ref/g_classical.py).
type Leaf = { path: string; p: number; cbits: string };
const fx = loadFixture<{ n: number; tape: Entry[]; cbits: number[]; resources: Record<string, number>; branches: Leaf[] | null }>("classical");

describe(`classical control (vs ${fx.meta.reference})`, () => {
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const mine = compute({ id: c.id, n: c.n, tape: c.tape });
    expect(mine.cbits).toEqual(c.cbits);
    const res = mine.resources as unknown as Record<string, unknown>;
    expect(Object.fromEntries(Object.keys(c.resources).map((k) => [k, res[k]]))).toEqual(c.resources);
    // Branch tree: every history, checked by an enumerator over Qiskit's import and by Aer counts.
    expect(mine.branches === null).toBe(c.branches === null);
    if (c.branches) {
      expect(mine.branches!.map((b) => [b.path, b.cbits])).toEqual(c.branches.map((b) => [b.path, b.cbits]));
      mine.branches!.forEach((b, i) => expect(b.p).toBeCloseTo(c.branches![i].p, 9));
    }
  });
});
