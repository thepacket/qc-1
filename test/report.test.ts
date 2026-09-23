import { describe, test, expect } from "vitest";
import { Calculator } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { runAnalysis } from "../src/analysis/run";

describe("session report", () => {
  test("opening fetches a live KET view (even from TAPE, even scrubbed); closing restores the mode's view", () => {
    const c = new Calculator(new InlineEngine());
    c.press("h");
    c.press("x");
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
    c.press("h");
    c.openAnalysis("density");
    c.pinAnalysis();
    expect(c.pins.map((p) => p.title)).toEqual(["Reduced density matrix"]);
    c.unpin(0);
    expect(c.pins).toHaveLength(0);
  });
});
