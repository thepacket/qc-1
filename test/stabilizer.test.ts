import { describe, test, expect } from "vitest";
import { groupSizes } from "../src/stab/clifford";
import { calc, add, cx } from "./ed";

describe("stabilizer mode (n > 20)", () => {
  test("Clifford groups: 24 and 11 520 elements", () => {
    expect(groupSizes()).toEqual([24, 11520]);
  });

  test("resize to 100 with a Clifford tape; a GHZ chain; generators and marginals", () => {
    const c = calc();
    add(c, "h", [0]);
    cx(c, 0, 1); // Bell on q0,q1 (n = 2)
    c.setQubitCount(100);
    expect(c.n).toBe(100);
    expect(c.stabilizerMode).toBe(true);
    // Extend the GHZ to q2..q5.
    for (let q = 1; q < 5; q++) cx(c, q, q + 1);
    const v = c.view!;
    if (v.mode !== "ket") throw new Error(v.mode);
    expect(v.generators!.length).toBe(100);
    expect(v.generators![0].length).toBe(101);
    c.setMode("prob");
    const p = c.view!;
    if (p.mode !== "prob") throw new Error(p.mode);
    expect(p.marginals!.slice(0, 7)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0]);
  });

  test("a non-Clifford gate is refused above 20 qubits and leaves the register untouched", () => {
    const c = calc();
    c.setQubitCount(30);
    add(c, "h", [0]);
    add(c, "t", [0]);
    expect(c.message?.kind).toBe("error");
    expect(c.tape).toHaveLength(1);
  });

  test("resizing a non-Clifford tape above 20 is refused; back below 20 works", () => {
    const c = calc();
    add(c, "t", [0]);
    c.setQubitCount(30);
    expect(c.n).toBe(2);
    expect(c.message?.kind).toBe("error");
    const d = calc();
    add(d, "h", [0]);
    d.setQubitCount(30);
    d.setQubitCount(10);
    expect(d.n).toBe(10);
    expect(d.stabilizerMode).toBe(false);
  });

  test("undo across the boundary: RCL of a 40-qubit program, then UNDO back to 2 qubits", () => {
    const c = calc();
    add(c, "h", [0]);
    c.loadQasm(`OPENQASM 3.0; include "stdgates.inc"; qubit[40] q; h q[0]; cx q[0], q[39]; s q[39];`, "import");
    expect(c.n).toBe(40);
    c.undo();
    expect(c.n).toBe(2);
    expect(c.tape).toHaveLength(1);
    c.redo();
    expect(c.n).toBe(40);
  });

  test("shots sample the tableau: a 30-qubit GHZ gives only all-zeros and all-ones", () => {
    const c = calc();
    c.loadQasm(`OPENQASM 3.0; include "stdgates.inc"; qubit[30] q; h q[0]; ${Array.from({ length: 29 }, (_, i) => `cx q[${i}], q[${i + 1}];`).join(" ")}`, "ghz");
    c.setMode("shots");
    const v = c.view!;
    if (v.mode !== "shots") throw new Error(v.mode);
    expect(new Set(v.rows.map((r) => r.bits))).toEqual(new Set(["0".repeat(30), "1".repeat(30)]));
  });
});
