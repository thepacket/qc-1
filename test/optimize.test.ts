import { describe, test, expect } from "vitest";
import { optimizeExpectation, computeLandscape, barrenPlateauDiagnostic } from "../src/sim/optimize";
import { lowerTape } from "../src/calc/lower";
import { Register } from "../src/calc/register";
import { parsePauliSum } from "../src/sim/trotter";
import { pauliSumExpectation } from "../src/sim/expectation";
import type { Entry } from "../src/calc/steps";

const st = (g: string, t: number[], p: string[] = [], c: number[] = []): Entry => [
  { id: `${g}${t}`, gateId: g, column: 0, targets: t, controls: c, clbits: [], params: p },
];
const Z = parsePauliSum("Z");

describe("optimiser (ideal)", () => {
  for (const optimizer of ["adam", "sgd", "qng"] as const) {
    test(`${optimizer}: RY(θ)|0⟩ minimises ⟨Z⟩ to −1`, async () => {
      const circ = lowerTape(1, [st("ry", [0], ["θ"])]);
      const res = await optimizeExpectation(circ, [], {
        symbols: ["theta"], observable: { kind: "sum", terms: Z }, initial: { theta: 0.3 },
        steps: 300, learningRate: optimizer === "sgd" ? 0.5 : 0.1, epsilon: 1e-4, goal: "minimize", optimizer,
      });
      expect(res.finalValue).toBeCloseTo(-1, 3);
      expect(Math.abs(Math.cos(res.finalParams.theta) + 1)).toBeLessThan(1e-3);
    });
  }

  test("starting exactly at a stationary point (the default θ = 0) still reaches the minimum", async () => {
    const res = await optimizeExpectation(lowerTape(1, [st("ry", [0], ["θ"])]), [], {
      symbols: ["theta"], observable: { kind: "sum", terms: Z }, initial: { theta: 0 },
      steps: 300, learningRate: 0.1, epsilon: 1e-4, goal: "minimize", optimizer: "adam",
    });
    expect(res.finalValue).toBeCloseTo(-1, 3);
  });

  test("2-qubit ansatz: ⟨ZZ⟩ maximum is +1 and the reported value matches a direct evaluation", async () => {
    const tape = [st("ry", [0], ["θ"]), st("ry", [1], ["φ"]), st("x", [1], [], [0])];
    const H = parsePauliSum("ZZ + 0.5*XI");
    const res = await optimizeExpectation(lowerTape(2, tape), [], {
      symbols: ["phi", "theta"], observable: { kind: "sum", terms: H }, initial: { theta: 0.2, phi: -0.4 },
      steps: 400, learningRate: 0.05, epsilon: 1e-4, goal: "maximize", optimizer: "adam",
    });
    const direct = pauliSumExpectation(new Register(2, tape, res.finalParams).state, 2, H);
    expect(res.finalValue).toBeCloseTo(direct, 10);
    // max over this ansatz: ZZ = cos φ ... bounded by the largest eigenvalue √(1 + 0.25)
    expect(res.finalValue).toBeLessThanOrEqual(Math.sqrt(1.25) + 1e-9);
    expect(res.finalValue).toBeGreaterThan(1.0);
  });

  test("landscape of ⟨Z⟩ for RY(θ) is cos θ on the grid", async () => {
    const grid = await computeLandscape(lowerTape(1, [st("ry", [0], ["θ"])]), { theta: 0 }, [], { kind: "sum", terms: Z }, ["theta"], 9, [-Math.PI, Math.PI]);
    grid[0].forEach((v, i) => expect(v).toBeCloseTo(Math.cos(-Math.PI + (2 * Math.PI * i) / 8), 10));
  });

  test("plateau: Var ∂⟨Z⟩/∂θ = ½ for RY(θ) with θ uniform on [−π, π]", async () => {
    const res = await barrenPlateauDiagnostic(lowerTape(1, [st("ry", [0], ["θ"])]), [], { kind: "sum", terms: Z }, ["theta"], 800);
    // Var(sin θ) = ½; the sample variance has sd ≈ √(1/8/800) ≈ 0.0125 → 5σ bound.
    expect(Math.abs(res.variancePerSymbol[0] - 0.5)).toBeLessThan(0.063);
  });
});
