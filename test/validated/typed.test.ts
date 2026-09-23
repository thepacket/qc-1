import { describe, test, expect } from "vitest";
import { cases, compute } from "../../validation/cases/groups/typed";
import { loadFixture, type CVec } from "./fixtures";

// References: the typed matrix/state, written independently as numpy, and Qiskit's import of the export (validation/ref/g_typed.py).
const fx = loadFixture<never>("typed");

describe(`typed states and matrices (vs ${fx.meta.reference})`, () => {
  test.each(cases().map((c) => [c.id, c] as const))("%s", (_, c) => {
    const want = (fx.cases.find((x) => x.id === c.id) as unknown as { want: CVec }).want;
    const flat = compute(c).cols.flat(); // columns, interleaved re/im
    let err = 0;
    for (let i = 0; i < want.re.length; i++) err = Math.max(err, Math.hypot(flat[2 * i] - want.re[i], flat[2 * i + 1] - want.im[i]));
    expect(err).toBeLessThan(1e-10);
  });
});
