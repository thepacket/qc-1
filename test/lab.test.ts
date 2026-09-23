import { describe, test, expect } from "vitest";
import { Calculator, type KeyId } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { runAnalysis, RUN_IDS } from "../src/analysis/run";
import { ANALYSES } from "../src/analysis/catalog";
import type { Chart } from "../src/analysis/types";

const calc = () => new Calculator(new InlineEngine(runAnalysis));
const keys = (c: Calculator, ...ks: KeyId[]) => ks.forEach((k) => c.press(k));
const bell = () => {
  const c = calc();
  keys(c, "h", "ctrl", "right", "x");
  c.setMode("lab");
  return c;
};
const chart = <K extends Chart["kind"]>(c: Calculator, kind: K, i = 0) =>
  c.analysis!.result!.charts!.filter((x) => x.kind === kind)[i] as Extract<Chart, { kind: K }>;
const scalar = (c: Calculator, label: string) => c.analysis!.result!.scalars!.find((s) => s.label === label)!.value;

describe("LAB framework", () => {
  test("every catalog entry has a compute function", () => {
    expect(ANALYSES.map((a) => a.id).sort()).toEqual([...RUN_IDS].sort());
  });

  test("every analysis runs on an entangled, symbolic state of a size it accepts, without error", async () => {
    for (const a of ANALYSES) {
      const n = Math.min(a.maxQubits, Math.max(a.minQubits ?? 1, 4));
      const c = calc();
      // A generically entangled state: H layer, CZ ring, RX(0.7) + T layers,
      // CZ ring again; plus symbols θ and t for the analyses that sweep them.
      keys(c, ...(String(n).split("") as KeyId[]), "2nd", "q", "all", "h");
      const czRing = () => { for (let q = 0; q < n; q++) keys(c, "ctrl", "right", "z"); };
      czRing();
      keys(c, "0", ".", "7", "all", "rx", "all", "t");
      czRing();
      keys(c, "2nd", ",", "ry", "2nd", ".", "rz");
      c.setSymbol("theta", 0.4);
      c.setSymbol("t", 0.9);
      c.setMode("lab");
      c.openAnalysis(a.id);
      for (let i = 0; i < 200 && c.analysis?.status !== "done"; i++) await new Promise((r) => setTimeout(r, 0));
      expect(c.n, a.id).toBe(n);
      expect(c.analysis?.result?.error, a.id).toBeUndefined();
      const r = c.analysis!.result!;
      expect((r.charts?.length ?? 0) + (r.scalars?.length ?? 0), a.id).toBeGreaterThan(0);
    }
  }, 60_000);

  test("Bell pair: MI = 2, E_N = 1, C = 1, ρ₀ maximally mixed", () => {
    const c = bell();
    c.openAnalysis("mutualinfo");
    expect(chart(c, "heatmap").values[0][1]).toBeCloseTo(2, 9);
    c.openAnalysis("negativity");
    expect(chart(c, "heatmap").values[0][1]).toBeCloseTo(1, 9);
    c.openAnalysis("concurrence");
    expect(chart(c, "heatmap").values[0][1]).toBeCloseTo(1, 7);
    c.openAnalysis("density");
    expect(scalar(c, "purity Tr ρ²")).toBeCloseTo(0.5, 9);
    expect(scalar(c, "entropy S(ρ)")).toBeCloseTo(1, 9);
  });

  test("phase disk angle is the relative phase (|+i⟩ → +90°)", () => {
    const c = calc();
    keys(c, "h", "s");
    c.setMode("lab");
    c.openAnalysis("phasedisk");
    const d = chart(c, "disks").disks[0];
    expect(d.re).toBeCloseTo(0, 9);
    expect(d.im).toBeCloseTo(0.5, 9);
  });

  test("Q-sphere of GHZ: two antipodal points of |a| = 1/√2", () => {
    const c = calc();
    keys(c, "3", "2nd", "q", "h", "ctrl", "right", "x", "ctrl", "right", "x");
    c.setMode("lab");
    c.openAnalysis("qsphere");
    const pts = chart(c, "qsphere").points;
    expect(pts.map((p) => p.label).sort()).toEqual(["|000⟩", "|111⟩"]);
    expect(pts[0].mag).toBeCloseTo(Math.SQRT1_2, 9);
    expect(pts[0].z + pts[1].z).toBeCloseTo(0, 9);
  });

  test("a live analysis refreshes when a gate is keyed in", () => {
    const c = calc();
    c.setMode("lab");
    c.openAnalysis("mutualinfo");
    expect(chart(c, "heatmap").values[0][1]).toBeCloseTo(0, 9);
    keys(c, "h", "ctrl", "right", "x");
    expect(chart(c, "heatmap").values[0][1]).toBeCloseTo(2, 9);
    expect(c.analysis!.rev).toBe(c.rev);
  });

  test("cut option reaches the computation", () => {
    const c = calc();
    keys(c, "3", "2nd", "q", "h", "ctrl", "right", "x"); // Bell on q0,q1; q2 idle
    c.setMode("lab");
    c.openAnalysis("schmidt");
    c.setLabOpts("schmidt", { cut: [2] });
    expect(scalar(c, "entropy S(A)")).toBeCloseTo(0, 9);
    c.setLabOpts("schmidt", { cut: [1] });
    expect(scalar(c, "entropy S(A)")).toBeCloseTo(1, 9);
  });

  test("AC in LAB goes back and never clears the register", () => {
    const c = bell();
    c.openAnalysis("negativity");
    keys(c, "ac");
    expect(c.lab.level).toBe("list");
    keys(c, "ac");
    expect(c.lab.level).toBe("cats");
    keys(c, "ac");
    expect(c.tape).toHaveLength(2);
  });

  test("◀ ▶ = navigate categories and lists, skipping empty categories", async () => {
    const { CATEGORIES, analysesIn } = await import("../src/analysis/catalog");
    const c = calc();
    c.setMode("lab");
    const usable = CATEGORIES.map((cat, i) => [i, analysesIn(cat.id).length] as const).filter(([, k]) => k > 0).map(([i]) => i);
    keys(c, "right");
    expect(c.lab.index).toBe(usable[1]);
    keys(c, "eq");
    expect(c.lab.level).toBe("list");
    keys(c, "eq");
    expect(c.lab.level).toBe("view");
    expect(c.lab.id).toBe(analysesIn(CATEGORIES[usable[1]].id)[0].id);
    keys(c, "ac", "ac");
    const ent = CATEGORIES.findIndex((x) => x.id === "entanglement");
    while (c.lab.index !== ent) keys(c, "right");
    keys(c, "eq", "eq");
    expect(c.lab.id).toBe("density");
  });

  test("results for a superseded request are not shown over a newer one", () => {
    class Deferred extends InlineEngine {
      jobs: Parameters<InlineEngine["analyze"]>[0][] = [];
      analyze(req: Parameters<InlineEngine["analyze"]>[0]) { this.jobs.push(req); }
      run(i: number) { super.analyze(this.jobs[i]); }
    }
    const eng = new Deferred(runAnalysis);
    const c = new Calculator(eng);
    c.setMode("lab");
    c.openAnalysis("schmidt"); // seq 1 in flight
    c.setLabOpts("schmidt", { cut: [1] }); // queued behind it
    eng.run(0); // reply to seq 1 → the queued request is sent as seq 2
    expect(eng.jobs).toHaveLength(2);
    eng.run(1);
    eng.run(0); // a late duplicate of seq 1 must not replace seq 2's result
    expect(c.analysis?.status).toBe("done");
    expect(scalar(c, "A")).toBe("q1");
  });

  test("a slow live analysis stops auto-refreshing until RUN", () => {
    const c = calc();
    c.setMode("lab");
    c.openAnalysis("mutualinfo");
    c.analysis = { ...c.analysis!, ms: 5000 }; // pretend the last run was slow
    const rev = c.analysis.rev;
    keys(c, "h");
    expect(c.analysis.rev).toBe(rev); // not recomputed
    c.requestAnalysis();
    expect(c.analysis!.rev).toBe(c.rev);
  });
});
