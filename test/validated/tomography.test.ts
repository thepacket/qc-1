import { describe, test, expect } from "vitest";
import { cases, compute } from "../../validation/cases/groups/tomography";
import { loadFixture } from "./fixtures";

// References: numpy linear inversion with Qiskit's Pauli matrices, Smolin–Gambetta–Smith (validation/ref/g_tomography.py).
const fx = loadFixture<never>("tomography");

describe(`state tomography (vs ${fx.meta.reference})`, () => {
  test.each(cases().map((c) => [c.id, c] as const))("%s", (_, c) => {
    const ref = fx.cases.find((x) => x.id === c.id) as unknown as { rhoHat: number[]; values: number[] };
    expect(ref).toBeDefined();
    const got = compute(c);
    got.rhoHat.forEach((v, i) => expect(Math.abs(v - ref.rhoHat[i])).toBeLessThan(1e-10));
    got.values.forEach((v, i) => expect(Math.abs(v - ref.values[i])).toBeLessThan(1e-10));
  });
});
