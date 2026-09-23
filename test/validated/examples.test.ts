import { describe, test, expect } from "vitest";
import { compute } from "../../validation/cases/groups/examples";
import { loadFixture, maxDiff, type CVec } from "./fixtures";

// References: Qiskit's reading of each ORIGINAL example file (normalised only
// where its importer needs it), at the same symbol values
// (validation/ref/g_examples.py).
type Ex = { file: string; n: number; kind: "state" | "branches"; state?: CVec; top?: [number, number, number][]; branches?: { path: string; p: number }[] };
const fx = loadFixture<Ex>("examples");

describe(`examples (vs ${fx.meta.reference})`, () => {
  test.each(fx.cases.map((c) => [c.file, c] as const))("%s", (_, c) => {
    const mine = compute(c.file);
    expect(mine.n).toBe(c.n);
    expect(mine.kind).toBe(c.kind);
    if (mine.kind === "state") {
      const st = Float64Array.from(mine.state);
      if (c.state) expect(maxDiff(st, c.state)).toBeLessThan(fx.meta.tol.abs);
      for (const [i, re, im] of c.top ?? []) {
        expect(st[2 * i]).toBeCloseTo(re, 9);
        expect(st[2 * i + 1]).toBeCloseTo(im, 9);
      }
    } else {
      expect(mine.branches.map((b) => b.path)).toEqual(c.branches!.map((b) => b.path));
      mine.branches.forEach((b, i) => expect(b.p).toBeCloseTo(c.branches![i].p, 9));
    }
  });
});
