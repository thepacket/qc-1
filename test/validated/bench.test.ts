import { describe, test, expect } from "vitest";
import { compute } from "../../validation/cases/groups/bench";
import { classicalShadows, cliffordGroup } from "../../src/noise/bench";
import { cliffordGenerators } from "../../src/analysis/tools";
import { BENCH_RUNS } from "../../src/analysis/benchRuns";
import { Register } from "../../src/calc/register";
import { pauliSumExpectation } from "../../src/sim/expectation";
import { loadFixture } from "./fixtures";

// References: Aer errors on DensityMatrix, scipy curve_fit, closed forms (validation/ref/g_bench.py).
type B = { id: string; survival?: number[]; p?: number; A?: number; B?: number; interleaved?: number[]; purity?: number[]; u?: number; T1?: number; T2?: number };
const fx = loadFixture<B>("bench");

describe(`benchmarking (vs ${fx.meta.reference})`, () => {
  const mine = compute();
  const ref = Object.fromEntries(fx.cases.map((c) => [c.id, c]));
  test("RB survival, fit and interleaved survival", () => {
    mine.rb.survival.forEach((v, i) => expect(v).toBeCloseTo(ref.rb.survival![i], 9));
    expect(mine.rb.p).toBeCloseTo(ref.rb.p!, 6);
    mine.rbi.survival.forEach((v, i) => expect(v).toBeCloseTo(ref.rb.interleaved![i], 9));
  });
  test("interleaved X with only X noisy: Aer survival and p = 1 − λ (the X gate itself runs)", () => {
    mine.rbx.survival.forEach((v, i) => expect(v).toBeCloseTo(ref.rbx.survival![i], 9));
    expect(mine.rbx.p).toBeCloseTo(ref.rbx.p!, 6);
  });
  test("unitarity", () => {
    mine.unitarity.purity.forEach((v, i) => expect(v).toBeCloseTo(ref.unitarity.purity![i], 9));
    expect(mine.unitarity.u).toBeCloseTo(ref.unitarity.u!, 6);
  });
  test("T1 and T2 fits recover the closed forms", () => {
    expect(mine.t1t2.ad.T1).toBeCloseTo(ref.t1t2.T1!, 5);
    expect(mine.t1t2.pd.T2).toBeCloseTo(ref.t1t2.T2!, 5);
  });
});

describe("benchmarking properties", () => {
  test("the Clifford group has 24 elements with consistent inverses", () => {
    const G = cliffordGroup();
    expect(G.gates).toHaveLength(24);
    G.inv.forEach((j, i) => expect(G.comp[i][j]).toBe(0));
  });

  test("classical shadows are unbiased (within 5σ) on a random state", () => {
    const reg = new Register(3, [[{ id: "a", gateId: "u", column: 0, targets: [0], controls: [], clbits: [], params: ["0.8", "0.3", "1.1"] }],
      [{ id: "b", gateId: "x", column: 0, targets: [1], controls: [0], clbits: [], params: [] }],
      [{ id: "c", gateId: "ry", column: 0, targets: [2], controls: [], clbits: [], params: ["1.2"] }]]);
    const sh = classicalShadows(3, reg.state, 20000, 7);
    for (const P of ["ZZI", "XXI", "IIZ", "IIX", "YYI"]) {
      const e = sh.estimate(P), exact = pauliSumExpectation(reg.state, 3, [{ coefficient: 1, paulis: P }]);
      expect(Math.abs(e.mean - exact), P).toBeLessThan(5 * e.stderr + 1e-3);
    }
  });

  test("the random Clifford tool proposes a Clifford tape", () => {
    const reg = new Register(3);
    const r = BENCH_RUNS.randclifford({ n: 3, state: reg.state, tape: [], scope: {} }, { depth: 3 });
    expect(cliffordGenerators(3, r.proposal!.tape)).not.toBeNull();
  });
});
