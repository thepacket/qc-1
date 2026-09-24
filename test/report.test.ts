import { describe, test, expect } from "vitest";
import { Calculator } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { runAnalysis } from "../src/analysis/run";

describe("session report", () => {
  test("opening fetches a live KET view (even from TAPE, even scrubbed); closing restores the mode's view", () => {
    const c = new Calculator(new InlineEngine());
    c.addGate("h", { targets: [0] });
    c.addGate("x", { targets: [0] });
    c.setMode("tape");
    c.setScrub(1);
    c.toggleReport();
    expect(c.reportOpen).toBe(true);
    expect(c.reportKet?.rows.map((r) => r.i)).toEqual([0, 2]); // X·H|0⟩ = |+⟩ on q0 (n = 2): |00⟩, |10⟩; the live state, not the scrubbed one
    c.toggleReport();
    expect(c.reportOpen).toBe(false);
    expect(c.view?.mode).toBe("tape");
  });

  test("PIN keeps the LAB result on screen; unpin removes it", () => {
    const c = new Calculator(new InlineEngine(runAnalysis));
    c.addGate("h", { targets: [0] });
    c.openAnalysis("density");
    c.pinAnalysis();
    expect(c.pins.map((p) => p.title)).toEqual(["Reduced density matrix"]);
    c.unpin(0);
    expect(c.pins).toHaveLength(0);
  });
});

describe("video recording hooks", () => {
  test("nextView resolves with the view computed after a symbol change", async () => {
    const c = new Calculator(new InlineEngine());
    c.loadQasm(`OPENQASM 3.0; include "stdgates.inc"; input float t; qubit[1] q; ry(t) q[0];`, "sweep");
    c.setMode("prob");
    const seen: number[] = [];
    for (const t of [0, Math.PI / 2, Math.PI]) {
      const next = c.nextView();
      c.setSymbol("t", t);
      await next;
      const v = c.view!;
      if (v.mode !== "prob") throw new Error(v.mode);
      seen.push(v.rows.find((r) => r.i === 1)?.p ?? 0);
    }
    expect(seen.map((p) => +p.toFixed(6))).toEqual([0, 0.5, 1]);
  });
});
