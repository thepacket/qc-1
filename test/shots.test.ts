import { describe, test, expect } from "vitest";
import { Core, SHOT_ROWS, type ViewData } from "../src/calc/core";
import { importQasm } from "../src/qasm/import";

const shotsView = (qasm: string, shots: number) => {
  const core = new Core();
  const r = importQasm(qasm);
  core.handle({ t: "load", n: r.n, tape: r.tape });
  const v = core.view({ mode: "shots", shots, shotSeed: 1 }) as Extract<ViewData, { mode: "shots" }>;
  return v;
};
const hAll = (n: number) => `OPENQASM 3.0; include "stdgates.inc"; qubit[${n}] q; ${[...Array(n).keys()].map((q) => `h q[${q}];`).join(" ")}`;

describe("SHOTS view", () => {
  test("every shot is accounted for: listed outcomes plus the rest", () => {
    const v = shotsView(hAll(10), 1024);
    expect(v.rows.length).toBe(v.distinct); // ~650 outcomes: all listed now (was 32)
    expect(v.rows.reduce((s, r) => s + r.count, 0) + v.other).toBe(1024);
    expect(v.other).toBe(0);
  });

  test("beyond SHOT_ROWS distinct outcomes, the rest is one sum", () => {
    const v = shotsView(hAll(16), 20000);
    expect(v.rows).toHaveLength(SHOT_ROWS);
    expect(v.distinct).toBeGreaterThan(SHOT_ROWS);
    expect(v.rows.reduce((s, r) => s + r.count, 0) + v.other).toBe(20000);
    expect(v.other).toBeGreaterThan(0);
  });

  test("stabilizer mode says when its work budget ran fewer shots than asked", () => {
    const v = shotsView(hAll(400), 5000);
    expect(v.shots).toBeLessThan(5000);
    expect(v.requested).toBe(5000);
    expect(v.rows.reduce((s, r) => s + r.count, 0) + v.other).toBe(v.shots);
    expect(shotsView(hAll(30), 100).requested).toBeUndefined();
  });
});
