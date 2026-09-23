import { describe, test, expect } from "vitest";
import { cases, compute } from "../../validation/cases/groups/dynamics";
import { deepClose, loadFixture } from "./fixtures";

// References: qiskit statevectors/operators at each t + numpy definitions
// (validation/ref/g_dynamics.py); the Rabi case is also checked against cos t.
const fx = loadFixture<Record<string, unknown>>("dynamics");
const byId = new Map(cases().map((c) => [c.id, c]));

describe(`dynamics (vs ${fx.meta.reference})`, () => {
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const { prefixQasm: _q, ...mine } = JSON.parse(JSON.stringify(compute(byId.get(c.id)!)));
    expect(deepClose(mine, c.expected, fx.meta.tol.abs)).toEqual([]);
  });
});
