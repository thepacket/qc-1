import { describe, test, expect } from "vitest";
import { compute, computePage, pagePairs } from "../../validation/cases/groups/entanglement";
import { deepClose, loadFixture } from "./fixtures";

// References: qiskit.quantum_info + numpy (see validation/ref/g_entanglement.py).
const fx = loadFixture<ReturnType<typeof compute>>("entanglement");
const { abs, ...tols } = fx.meta.tol as { abs: number } & Record<string, number>;

describe(`entanglement (vs qiskit ${fx.meta.versions.qiskit})`, () => {
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    expect(deepClose(compute(c), c.expected, abs, tols)).toEqual([]);
  });
});

test("Page average entropy (closed form, checked against Haar Monte Carlo)", () => {
  const page = loadFixture<number>("page");
  const mine = computePage();
  expect(page.cases.map((c) => c.id)).toEqual(pagePairs.map(([a, b]) => `page${a}${b}`));
  page.cases.forEach((c, i) => expect(mine[i]).toBeCloseTo(c.expected, 9));
});
