import { describe, test, expect } from "vitest";
import { Calculator } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { runAnalysis, RUN_IDS } from "../src/analysis/run";
import { ANALYSES } from "../src/analysis/catalog";
import type { Chart } from "../src/analysis/types";
import { add, cx } from "./ed";

const calc = () => new Calculator(new InlineEngine(runAnalysis));
const bell = () => {
  const c = calc();
  add(c, "h", [0]);
  cx(c, 0, 1);
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
    // The plot program needs a browser worker for its sandbox (test/plotProgram.test.ts covers the rest).
    for (const a of ANALYSES.filter((x) => x.id !== "plotprogram")) {
      const n = Math.min(a.maxQubits, Math.max(a.minQubits ?? 1, 4));
      const c = calc();
      // A generically entangled state: H layer, CZ ring, RX(0.7) + T layers,
      // CZ ring again; plus symbols θ and t for the analyses that sweep them.
      c.setQubitCount(n);
      c.addBroadcast("h");
      const czRing = () => { if (n > 1) for (let q = 0; q < n; q++) cx(c, q, (q + 1) % n, "z"); };
      czRing();
      c.addBroadcast("rx", ["0.7"]);
      c.addBroadcast("t");
      czRing();
      add(c, "ry", [0], { params: ["theta"] });
      add(c, "rz", [0], { params: ["t"] });
      c.setSymbol("theta", 0.4);
      c.setSymbol("t", 0.9);
      if (a.category === "noise" || a.category === "bench") c.setNoise({ enabled: true, p1: 0.02, p2: 0.05, ad: 0.01, pd: 0.01, readout: 0.02, trajectories: 64 });
      c.setMode("lab");
      // Hamiltonian-based analyses need a generic (non-degenerate) H.
      if (a.inputs.some((i) => i.kind === "pauli")) {
        const P = (q: number, p: string) => Array.from({ length: n }, (_, k) => (k === q ? p : "I")).join("");
        const H = [...Array(n).keys()].map((q) => `${(0.37 + 0.11 * q).toFixed(2)}*${P(q, "X")} + ${(0.29 - 0.07 * q).toFixed(2)}*${P(q, "Z")}`).join(" + ")
          + (n > 1 ? ` + 0.53*${"Z".repeat(2)}${"I".repeat(n - 2)} + 0.41*${"Y".repeat(2)}${"I".repeat(n - 2)}` : "");
        c.setLabOpts(a.id, { obs: H });
      }
      c.openAnalysis(a.id);
      for (let t0 = Date.now(); c.analysis?.status !== "done" && Date.now() - t0 < 30_000;) await new Promise((r) => setTimeout(r, 1));
      expect(c.n, a.id).toBe(n);
      expect(c.analysis?.result?.error, a.id).toBeUndefined();
      const r = c.analysis!.result!;
      expect((r.charts?.length ?? 0) + (r.scalars?.length ?? 0), a.id).toBeGreaterThan(0);
    }
  }, 120_000);

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
    add(c, "h", [0]);
    add(c, "s", [0]);
    c.setMode("lab");
    c.openAnalysis("phasedisk");
    const d = chart(c, "disks").disks[0];
    expect(d.re).toBeCloseTo(0, 9);
    expect(d.im).toBeCloseTo(0.5, 9);
  });

  test("Q-sphere of GHZ: two antipodal points of |a| = 1/√2", () => {
    const c = calc();
    c.setQubitCount(3);
    add(c, "h", [0]);
    cx(c, 0, 1);
    cx(c, 1, 2);
    c.setMode("lab");
    c.openAnalysis("qsphere");
    const pts = chart(c, "qsphere").points;
    expect(pts.map((p) => p.label).sort()).toEqual(["|000⟩", "|111⟩"]);
    expect(pts[0].mag).toBeCloseTo(Math.SQRT1_2, 9);
    expect(pts[0].z + pts[1].z).toBeCloseTo(0, 9);
  });

  test("a live analysis refreshes when a gate is added", () => {
    const c = calc();
    c.setMode("lab");
    c.openAnalysis("mutualinfo");
    expect(chart(c, "heatmap").values[0][1]).toBeCloseTo(0, 9);
    add(c, "h", [0]);
    cx(c, 0, 1);
    expect(chart(c, "heatmap").values[0][1]).toBeCloseTo(2, 9);
    expect(c.analysis!.rev).toBe(c.rev);
  });

  test("cut option reaches the computation", () => {
    const c = calc();
    c.setQubitCount(3);
    add(c, "h", [0]);
    cx(c, 0, 1); // Bell on q0,q1; q2 idle
    c.setMode("lab");
    c.openAnalysis("schmidt");
    c.setLabOpts("schmidt", { cut: [2] });
    expect(scalar(c, "entropy S(A)")).toBeCloseTo(0, 9);
    c.setLabOpts("schmidt", { cut: [1] });
    expect(scalar(c, "entropy S(A)")).toBeCloseTo(1, 9);
  });

  test("back in LAB goes up a level and never clears the register", () => {
    const c = bell();
    c.openAnalysis("negativity");
    c.labBack();
    expect(c.lab.level).toBe("list");
    c.labBack();
    expect(c.lab.level).toBe("cats");
    c.labBack();
    expect(c.lab.level).toBe("cats");
    expect(c.tape).toHaveLength(2);
  });

  test("picking groups and lists; empty groups (no favourites yet) can't be opened", async () => {
    const { analysesIn } = await import("../src/analysis/catalog");
    const c = calc();
    c.setMode("lab");
    const groups = c.labGroups();
    const usable = groups.map((g, i) => [i, g.items.length] as const).filter(([, k]) => k > 0).map(([i]) => i);
    expect(groups[c.lab.index].id).toBe("state"); // Favourites and Recent are empty: the lit row starts at State
    const fav = groups.findIndex((x) => x.id === "fav");
    expect(groups[fav].items).toHaveLength(0);
    c.labPick("cats", fav); // refused
    expect(c.lab.level).toBe("cats");
    c.labPick("cats", usable[1]);
    expect(c.lab.level).toBe("list");
    c.labPick("list", 0);
    expect(c.lab.level).toBe("view");
    expect(c.lab.id).toBe(groups[usable[1]].items[0].id);
    c.labBack(); c.labBack();
    expect(c.lab.index).toBe(usable[1]);
    c.labPick("cats", groups.findIndex((x) => x.id === "entanglement"));
    c.labPick("list", 0);
    expect(c.lab.id).toBe("density");
    expect(analysesIn("entanglement")[0].id).toBe("density");
  });

  test("a panel in two groups opens from either and goes back to the one it came from", () => {
    const c = calc();
    c.setMode("lab");
    const at = (id: string) => c.labGroups().findIndex((g) => g.id === id);
    for (const g of ["dynamics", "chaos"]) {
      c.labPick("cats", at(g));
      const i = c.labGroup().items.findIndex((a) => a.id === "otoc");
      expect(i).toBeGreaterThanOrEqual(0);
      c.labPick("list", i);
      expect(c.lab.id).toBe("otoc");
      c.labBack(); c.labBack();
      expect(c.labGroups()[c.lab.index].id).toBe(g);
    }
  });

  test("favourites, recent and search", () => {
    const c = calc();
    c.setMode("lab");
    c.openAnalysis("berry");
    c.openAnalysis("qfi");
    c.toggleFavourite("qfi");
    expect(c.isFavourite("qfi")).toBe(true);
    const g = (id: string) => c.labGroups().find((x) => x.id === id)!.items.map((a) => a.id);
    expect(g("fav")).toEqual(["qfi"]);
    expect(g("recent")).toEqual(["qfi", "berry"]);
    c.labBack(); c.labBack();
    expect(c.labGroups()[c.lab.index].id).toBe(c.labGroups()[c.lab.index].id);
    c.labSearch("chern");
    expect(c.lab.level).toBe("list");
    expect(c.labGroup().items.map((a) => a.id)).toEqual(["chern"]);
    c.labPick("list", 0);
    expect(c.lab.id).toBe("chern");
    c.labBack();
    expect(c.labGroup().id).toBe("search"); // back to the matches
    c.labBack();
    expect(c.lab.level).toBe("cats");
    expect(c.lab.query).toBe("");
    c.toggleFavourite("qfi");
    expect(g("fav")).toEqual([]);
    // Removing the last favourite from inside Favourites: back skips the emptied group.
    c.toggleFavourite("zx");
    c.labPick("cats", 0);
    c.labPick("list", 0);
    c.toggleFavourite("zx");
    c.labBack();
    expect(c.lab.level).toBe("cats");
    expect(c.labGroups()[c.lab.index].items.length).toBeGreaterThan(0);
  });

  test("favourites and recent survive a reload; a session saved with a category index still opens", () => {
    const a = calc();
    a.setMode("lab");
    a.openAnalysis("chern");
    a.toggleFavourite("chern");
    const saved = JSON.parse(JSON.stringify(a.save()));
    const b = new Calculator(new InlineEngine(runAnalysis), saved);
    expect(b.lab.favs).toEqual(["chern"]);
    expect(b.lab.recent[0]).toBe("chern");
    expect(b.lab.level).toBe("view");
    expect(b.lab.id).toBe("chern");
    // Before groups: { level: "list", cat: 4, index: 3 }, plus a favourite that no longer exists.
    const old = { ...saved, lab: { level: "list", cat: 4, index: 3, id: null, opts: {}, favs: ["chern", "gone"] } };
    const c = new Calculator(new InlineEngine(runAnalysis), old);
    expect(c.lab.level).toBe("cats");
    expect(c.lab.favs).toEqual(["chern"]);
    expect(c.labGroups()[c.lab.index].items.length).toBeGreaterThan(0);
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
    add(c, "h", [0]);
    expect(c.analysis.rev).toBe(rev); // not recomputed
    c.requestAnalysis();
    expect(c.analysis!.rev).toBe(c.rev);
  });
});

describe("Phase 5b dynamics in LAB", () => {
  const rabi = () => {
    const c = calc();
    add(c, "rx", [0], { params: ["t"] }); // RX(t) on q0: ⟨Z⟩(t) = cos t
    c.setMode("lab");
    return c;
  };

  test("t-sweep of RX(t) traces cos t; its spectrum peaks at one oscillation per period", () => {
    const c = rabi();
    c.openAnalysis("tsweep");
    const l = chart(c, "lines");
    l.x.forEach((x, i) => expect(l.series[0].y[i]).toBeCloseTo(Math.cos(x * Math.PI), 9));
    c.openAnalysis("tsweepfft");
    const v = chart(c, "bars").values;
    expect(v.indexOf(Math.max(...v))).toBe(1);
  });

  test("Loschmidt echo of RX(t) is cos²(t/2)", () => {
    const c = rabi();
    c.openAnalysis("loschmidt");
    const l = chart(c, "lines");
    l.x.forEach((x, i) => expect(l.series[0].y[i]).toBeCloseTo(Math.cos((x * Math.PI) / 2) ** 2, 9));
  });

  test("t-sweeps refuse a tape without t", () => {
    const c = bell();
    c.openAnalysis("tsweep");
    expect(c.analysis!.result!.error).toMatch(/symbol t/);
  });

  test("light cone: q2 idle is outside a Bell pair's backward cone of q0", () => {
    const c = calc();
    c.setQubitCount(3);
    add(c, "h", [0]);
    cx(c, 0, 1);
    add(c, "x", [1]);
    c.setMode("lab");
    c.openAnalysis("lightcone");
    expect(scalar(c, "backward cone of q0")).toBe("2 of 3 gates");
  });
});

describe("Phase 6 circuit tools in LAB", () => {
  const run = (c: Calculator, id: string, opts: Record<string, unknown> = {}) => {
    c.setMode("lab");
    c.setLabOpts(id, opts);
    c.openAnalysis(id);
    c.requestAnalysis();
    return c.analysis!.result!;
  };

  test("Simplify proposes a verified shorter tape; APPLY replaces it, UNDO restores", () => {
    const c = calc();
    for (const g of ["h", "h", "s", "s"]) add(c, g, [0]);
    cx(c, 0, 1);
    const r = run(c, "simplify");
    expect(r.proposal?.verified).toBe(true);
    expect(r.proposal!.tape.length).toBeLessThan(5);
    c.applyProposal(r.proposal!);
    expect(c.tape.length).toBe(r.proposal!.tape.length);
    c.undo();
    expect(c.tape.length).toBe(5);
  });

  test("appending U† returns the register to |0…0⟩", () => {
    const c = calc();
    add(c, "h", [0]);
    cx(c, 0, 1);
    add(c, "t", [1]);
    add(c, "rx", [1]);
    const r = run(c, "inverse", { mode: 0 });
    c.applyProposal(r.proposal!);
    c.setMode("ket");
    const v = c.view!;
    if (v.mode !== "ket") throw new Error();
    expect(v.nonzero).toBe(1);
    expect(v.rows[0].i).toBe(0);
  });

  test("state preparation of GHZ, and routing a far CX on a line", () => {
    const c = calc();
    c.setQubitCount(3);
    const r = run(c, "stateprep", { target: "1,0,0,0,0,0,0,1" });
    expect(r.proposal?.verified).toBe(true);
    expect(r.scalars!.find((s) => s.label === "|⟨target|ψ⟩|")!.value as number).toBeCloseTo(1, 12);
    const d = calc();
    d.setQubitCount(3);
    add(d, "h", [0]);
    cx(d, 0, 2);
    const rt = run(d, "route", { coupling: 0 });
    expect(rt.proposal?.verified).toBe(true);
    expect(rt.scalars!.find((s) => s.label === "SWAPs inserted")!.value).toBe(1);
  });

  test("Trotter circuit in t; its error shrinks with the order (at t = 1)", () => {
    const c = calc();
    const err = (order: number) => {
      const r = run(c, "trotter", { ham: "ZZ + 0.5*XI + 0.5*IX", steps: 4, order });
      expect(r.proposal!.tape.flat().some((s) => s.params.some((p) => /\bt\b/.test(p)))).toBe(true);
      return r.scalars!.find((s) => s.label.startsWith("error"))!.value as number;
    };
    const [e1, e2, e4] = [err(0), err(1), err(2)];
    expect(e1).toBeGreaterThan(e2);
    expect(e2).toBeGreaterThan(e4);
    expect(e4).toBeGreaterThan(0);
  });

  test("stabilizer tableau of a Bell pair: +XX, +ZZ", () => {
    const c = bell();
    const r = run(c, "tableau");
    const rows = (r.charts![0] as Extract<Chart, { kind: "table" }>).rows.map((row) => `${row[1]}${row[2]}`).sort();
    expect(rows).toEqual(["+XX", "+ZZ"]);
  });
});
