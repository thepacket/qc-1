import { describe, test, expect } from "vitest";
import { computeState, computeSym, stateCasesM, symCases } from "../../validation/cases/groups/metrology";
import { deepClose, loadFixture } from "./fixtures";

// References: independent Pauli-sum parser + Qiskit SparsePauliOp; Richardson
// derivatives of Qiskit statevectors for the QGT (validation/ref/g_metrology.py).
const json = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe("expectation & metrology (vs qiskit)", () => {
  const fx = loadFixture<Record<string, unknown>>("metrology");
  const byId = new Map(stateCasesM().map((c) => [c.id, c]));
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    expect(deepClose(json(computeState(byId.get(c.id)!)), c.expected, fx.meta.tol.abs)).toEqual([]);
  });
});

describe("symbolic circuits: QGT, Bloch paths, prefix sweeps, landscape (vs qiskit)", () => {
  const fx = loadFixture<Record<string, unknown>>("metrology-symbolic");
  const tol = fx.meta.tol as { abs: number; qgt: number };
  const byId = new Map(symCases().map((c) => [c.id, c]));
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", async (_, c) => {
    const mine = json(await computeSym(byId.get(c.id)!));
    expect(deepClose(mine, c.expected, tol.abs, { qgt: tol.qgt })).toEqual([]);
  });
});
