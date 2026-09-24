import { describe, test, expect } from "vitest";
import { Calculator } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { runAnalysis } from "../src/analysis/run";
import { formatEntry } from "../src/calc/steps";

import { add, cx } from "./ed";

const settle = async (c: Calculator, until: () => boolean) => {
  for (let t0 = Date.now(); !until() && Date.now() - t0 < 5000;) await new Promise((r) => setTimeout(r, 5));
};

describe("fixes from review", () => {
  test("noisy PROB follows the scrub position (H → CX, scrubbed to step 1: no |11⟩)", async () => {
    const c = new Calculator(new InlineEngine(runAnalysis));
    add(c, "h", [0]);
    cx(c, 0, 1); // H q0, CX q0→q1
    c.setNoise({ enabled: true, p1: 0.001, p2: 0.001 });
    c.setMode("prob");
    c.setScrub(1);
    await settle(c, () => c.noisyView?.view?.mode === "prob" && c.noisyView?.seq === (c as unknown as { vSeq: number }).vSeq);
    const v = c.noisyView!.view!;
    if (v.mode !== "prob") throw new Error(v.mode);
    const p = (i: number) => v.rows.find((r) => r.i === i)?.p ?? 0;
    expect(p(0b10)).toBeGreaterThan(0.45); // H on q0 only: |00⟩ and |10⟩
    expect(p(0b11)).toBeLessThan(0.05);
  });

  test("a refused gate leaves the insertion point where it was", () => {
    const c = new Calculator(new InlineEngine());
    c.setQubitCount(30); // stabilizer mode
    add(c, "h", [0]);
    add(c, "x", [0]);
    c.setScrub(1);
    add(c, "t", [0]); // not Clifford: refused
    expect(c.message?.kind).toBe("error");
    expect(c.scrub).toBe(1);
    add(c, "s", [0]);
    expect(c.tape.map(formatEntry)).toEqual(["H q0", "S q0", "X q0"]);
  });

  test("reloading keeps the selected qubit", () => {
    const a = new Calculator(new InlineEngine());
    a.setQubitCount(5);
    a.select(4);
    expect(a.sel).toBe(4);
    const b = new Calculator(new InlineEngine(), a.save());
    expect(b.sel).toBe(4);
    expect(b.n).toBe(5);
  });
});
