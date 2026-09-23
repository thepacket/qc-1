import { describe, test, expect } from "vitest";
import { circCases, computeCirc, computeGeom, computeHam, geomCases, hamCases } from "../../validation/cases/groups/spectrum";
import { deepClose, loadFixture } from "./fixtures";

// References: qiskit Operator; numpy definitions (PTM, SVD, eigvals, eigh,
// Lanczos, expm, energy projectors); qiskit statevectors for Berry/Chern.
const json = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe("operator (vs qiskit Operator + numpy)", () => {
  const fx = loadFixture<Record<string, unknown>>("spectrum-circuits");
  const byId = new Map(circCases().map((c) => [c.id, c]));
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    expect(deepClose(json(computeCirc(byId.get(c.id)!)), c.expected, fx.meta.tol.abs)).toEqual([]);
  });
});

describe("Hamiltonian spectra, degenerate ones included (vs numpy)", () => {
  const fx = loadFixture<Record<string, unknown>>("spectrum-hamiltonians");
  const circs = new Map(circCases().map((c) => [c.id, c]));
  const hams = new Map(hamCases().map((h) => [h.id, h]));
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const mine = json(computeHam(hams.get(c.id)!, circs.get(c.stateId as string)!));
    expect(deepClose(mine, c.expected, fx.meta.tol.abs)).toEqual([]);
  });
});

describe("Berry phase and Chern number (vs qiskit statevectors)", () => {
  const fx = loadFixture<Record<string, unknown>>("spectrum-geometry");
  const byId = new Map(geomCases().map((g) => [g.id, g]));
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    expect(deepClose(json(computeGeom(byId.get(c.id)!)), c.expected, fx.meta.tol.abs)).toEqual([]);
  });
});
