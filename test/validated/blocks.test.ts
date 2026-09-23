import { describe, test, expect } from "vitest";
import { cases, compute } from "../../validation/cases/groups/blocks";
import { loadFixture } from "./fixtures";

// References: Qiskit's QFTGate and QAOAAnsatz operators, and 2|s⟩⟨s| − I (validation/ref/g_blocks.py).
const fx = loadFixture<never>("blocks");

describe(`algorithm blocks (vs ${fx.meta.reference})`, () => {
  test.each(cases().map((c) => [c.id, c] as const))("%s", (_, c) => {
    const ref = fx.cases.find((x) => x.id === c.id)! as unknown as { unitary: { re: number[][]; im: number[][] } };
    const { unitary } = compute(c);
    let err = 0;
    unitary.forEach((col, j) => col.forEach((v, i) => {
      const want = i % 2 ? ref.unitary.im[j][i >> 1] : ref.unitary.re[j][i >> 1];
      err = Math.max(err, Math.abs(v - want));
    }));
    expect(err).toBeLessThan(1e-10);
  });
});
