import { describe, test, expect } from "vitest";
import { toolCircuit, raiseCircuit, ToolInputError } from "../src/calc/toolCircuit";
import { equivalent } from "../src/calc/equiv";
import { optimiseCircuit } from "../src/sim/optimisePasses";
import { transpile, type TranspileTarget } from "../src/sim/transpile";
import { routeCircuit } from "../src/sim/router";
import { compileForDevice } from "../src/sim/compile";
import { inverseGates } from "../src/sim/inverse";
import { randomTape, rng } from "../validation/cases/tapes";
import type { Entry } from "../src/calc/steps";

const line = (n: number) => Array.from({ length: n }, (_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < n));

function toolTapes(seed: number, count: number): { n: number; tape: Entry[] }[] {
  const r = rng(seed);
  const out: { n: number; tape: Entry[] }[] = [];
  while (out.length < count) {
    const n = 1 + r.int(4);
    const tape = randomTape(r, n, 3 + r.int(10)).filter((e) => {
      try { toolCircuit(n, [e]); return true; } catch (err) { if (err instanceof ToolInputError) return false; throw err; }
    });
    out.push({ n, tape });
  }
  return out;
}

describe("tools keep the operator (120 random tapes, QC-1 simulator)", () => {
  const cases = toolTapes(42, 120);
  const tools: [string, (n: number, t: Entry[]) => { tape: Entry[]; perm?: number[] }][] = [
    ["roundtrip", (n, t) => ({ tape: raiseCircuit(toolCircuit(n, t)) })],
    ["optimise", (n, t) => ({ tape: raiseCircuit(optimiseCircuit(toolCircuit(n, t)).circuit) })],
    ["optimise-deep", (n, t) => ({ tape: raiseCircuit(optimiseCircuit(toolCircuit(n, t), { deep: true }).circuit) })],
    ...(["clifford-t", "ibm-heavy-hex", "rigetti"] as TranspileTarget[]).map((tg) =>
      [`transpile-${tg}`, (n: number, t: Entry[]) => ({ tape: raiseCircuit(transpile(toolCircuit(n, t), tg).circuit) })] as [string, (n: number, t: Entry[]) => { tape: Entry[] }]),
    ["route-line", (n, t) => { const r = routeCircuit(toolCircuit(n, t), line(n)); return { tape: raiseCircuit(r.circuit), perm: r.finalMapping }; }],
  ];
  for (const [name, f] of tools) {
    test(name, () => {
      const bad: string[] = [];
      cases.forEach((c, k) => {
        let out;
        try { out = f(c.n, c.tape); } catch (e) { bad.push(`#${k} threw ${(e as Error).message}`); return; }
        const eq = equivalent(c.n, c.tape, out.tape, { perm: out.perm });
        if (!eq.equal) bad.push(`#${k} n=${c.n} err=${eq.maxErr.toExponential(2)} ${c.tape.map((e) => e.map((s) => `${s.gateId}${s.controls.length ? "c" + s.controls.join("") : ""}(${s.targets})`).join(";")).join(" ")}`);
      });
      expect(bad.slice(0, 6), `${bad.length} failures`).toEqual([]);
    });
  }
  test("inverse", () => {
    const bad: string[] = [];
    cases.forEach((c, k) => {
      const circ = toolCircuit(c.n, c.tape);
      const { inverted, skipped } = inverseGates(circ, 0, 1e9);
      const both = [...c.tape, ...raiseCircuit({ ...circ, gates: inverted })];
      const eq = equivalent(c.n, both, []);
      if (!eq.equal || skipped.length) bad.push(`#${k} err=${eq.maxErr.toExponential(2)} skipped=${skipped.map((g) => g.gateId)}`);
    });
    expect(bad.slice(0, 6), `${bad.length} failures`).toEqual([]);
  });
});
