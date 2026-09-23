import { describe, test, expect } from "vitest";
import { layoutTape, usedQubits } from "../src/calc/diagram";
import { Register } from "../src/calc/register";
import { importQasm } from "../src/qasm/import";
import { randomTape, rng } from "../validation/cases/tapes";

describe("circuit diagram layout", () => {
  test("no two steps share a wire in a column, and column order replays the tape exactly", () => {
    const r = rng(11);
    for (let trial = 0; trial < 40; trial++) {
      const n = 1 + r.int(6);
      const tape = randomTape(r, n, 12);
      const lay = layoutTape(n, tape);
      const seen = new Set<string>();
      for (const it of lay.items) {
        for (let q = it.lo; q <= it.hi; q++) {
          const k = `${it.col}:${q}`;
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      }
      // Reading the diagram left to right (any order within a column) is the same circuit.
      const byCol = [...lay.items].sort((a, b) => a.col - b.col || b.entry - a.entry);
      // (commuting steps in another order: equal up to rounding)
      const a = new Register(n, byCol.map((it) => [it.step])).state, b = new Register(n, tape).state;
      expect(Math.max(...a.map((x, i) => Math.abs(x - b[i])))).toBeLessThan(1e-12);
    }
  });

  test("a conditional gate waits for the measurement that wrote its bit", () => {
    const { n, tape } = importQasm(`OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; bit[3] c;
      h q[0]; c[0] = measure q[0]; if (c[0] == true) x q[2];`);
    const lay = layoutTape(n, tape);
    const col = (i: number) => lay.items.find((it) => it.entry === i)!.col;
    expect(col(2)).toBeGreaterThan(col(1));
  });

  test("a wide register draws only the wires the tape touches", () => {
    const { n, tape } = importQasm(`OPENQASM 3.0; include "stdgates.inc"; qubit[200] q; h q[5]; cx q[5], q[150];`);
    const wires = usedQubits(tape);
    expect(wires).toEqual([5, 150]);
    const lay = layoutTape(n, tape, wires);
    expect(lay.items.map((it) => [it.lo, it.hi])).toEqual([[0, 0], [0, 1]]);
  });
});
