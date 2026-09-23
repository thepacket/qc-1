import { describe, test, expect } from "vitest";
import { cases, compute } from "../../validation/cases/groups/verify";
import { VERIFY_RUNS } from "../../src/analysis/verifyRuns";
import { Register } from "../../src/calc/register";
import type { AnalysisResult, Chart } from "../../src/analysis/types";
import { loadFixture } from "./fixtures";

// References: Qiskit process_fidelity / average_gate_fidelity / state_fidelity (validation/ref/g_verify.py).
const fx = loadFixture<Record<string, number>>("verify");

describe(`compare with memory (vs ${fx.meta.reference})`, () => {
  test.each(cases().map((c) => [c.id, c] as const))("%s", async (_, c) => {
    const mine = (await compute(c)).scalars as Record<string, number>;
    const ref = fx.cases.find((x) => x.id === c.id)!;
    for (const k of ["process fidelity |Tr(U†V)|²/d²", "average gate fidelity", "state fidelity |⟨ψ|φ⟩|²"]) expect(mine[k]).toBeCloseTo(ref[k], 10);
  });
});

describe("custom plot and self-test", () => {
  test("⟨Z⟩ of RX(t) over one period is cos t", async () => {
    const tape = [[{ id: "a", gateId: "rx", column: 0, targets: [0], controls: [], clbits: [], params: ["t"] }]];
    const reg = new Register(1, tape, { t: 0 });
    const r = (await VERIFY_RUNS.plot({ n: 1, state: reg.state, tape, scope: { t: 0 } }, { quantity: 0, sweep: 1 })) as AnalysisResult;
    const l = r.charts![0] as Extract<Chart, { kind: "lines" }>;
    l.x.forEach((x, i) => expect(l.series[0].y[i]).toBeCloseTo(Math.cos(x), 12));
  });

  test("the in-app self-test passes", async () => {
    const r = (await VERIFY_RUNS.selftest({ n: 2, state: new Float64Array(8), tape: [], scope: {} }, {})) as AnalysisResult;
    expect(r.scalars![0].value, JSON.stringify((r.charts![0] as Extract<Chart, { kind: "table" }>).rows)).toBe("all passed");
  }, 120_000);
});
