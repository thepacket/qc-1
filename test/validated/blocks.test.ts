import { describe, test, expect } from "vitest";
import { cases, compute } from "../../validation/cases/groups/blocks";
import { loadFixture } from "./fixtures";

// References: the Qiskit objects each block is named after (validation/ref/g_blocks.py).
const fx = loadFixture<never>("blocks");

describe(`block library (vs ${fx.meta.reference})`, () => {
  test.each(cases().map((c) => [c.id, c] as const))("%s", (_, c) => {
    const ref = fx.cases.find((x) => x.id === c.id)! as unknown as { unitary?: { re: number[][]; im: number[][] }; values?: number[][] };
    expect(ref).toBeDefined();
    const got = compute(c) as { values?: number[][]; unitary?: number[][] };
    if (got.values) {
      got.values.forEach((vs, i) => vs.forEach((v, j) => expect(Math.abs(v - ref.values![i][j])).toBeLessThan(1e-10)));
      return;
    }
    let err = 0;
    got.unitary!.forEach((col, j) => col.forEach((v, i) => {
      const want = i % 2 ? ref.unitary!.im[j][i >> 1] : ref.unitary!.re[j][i >> 1];
      err = Math.max(err, Math.abs(v - want));
    }));
    expect(err).toBeLessThan(1e-10);
  });
});
