import { describe, test, expect } from "vitest";
import { POINTS, compute } from "../../validation/cases/groups/symbolic";
import { exportQasm3 } from "../../src/qasm/fromTape";
import { loadFixture, maxDiff, type CVec } from "./fixtures";

// References: Qiskit imports the exported `input float` symbols as Parameters,
// binds them at each point, and gives the statevector.
const fx = loadFixture<CVec[]>("symbolic");

describe(`symbolic tapes (vs ${fx.meta.reference})`, () => {
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const mine = compute(c); // sets the case's custom gates
    expect(exportQasm3(c.n, c.tape)).toBe(c.qasm);
    POINTS.forEach((_, k) => {
      expect(maxDiff(Float64Array.from(mine[k].fresh), c.expected[k])).toBeLessThan(fx.meta.tol.abs);
      expect(maxDiff(Float64Array.from(mine[k].replayed), c.expected[k])).toBeLessThan(fx.meta.tol.abs);
    });
  });
});
