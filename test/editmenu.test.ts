import { describe, test, expect } from "vitest";
import { calc, add, cx, stateOf } from "./ed";
import { runAnalysis } from "../src/analysis/run";
import { formatEntry } from "../src/calc/steps";

const withTools = () => calc(null, runAnalysis);
const probs = (st: Float64Array) => Array.from({ length: st.length / 2 }, (_, i) => st[2 * i] ** 2 + st[2 * i + 1] ** 2);

describe("Edit menu (Quantiom's), on the diagram", () => {
  test("Repeat selection ×N and Fold keep the circuit; folding is the drawing only", () => {
    const c = calc();
    c.setQubitCount(2);
    add(c, "h", [0]);
    cx(c, 0, 1);
    c.selectAll();
    c.repeatSelection(3);
    expect(c.tape.map(formatEntry)).toEqual(Array(4).fill(["H q0", "CX q0→q1"]).flat());
    c.selectBox(0, 1, 0, 1);
    c.foldSelection();
    expect(c.folds).toEqual([{ from: 0, to: 1 }]);
    expect(c.tape).toHaveLength(8);
    c.unfold(0);
    expect(c.folds).toEqual([]);
  });

  test("Paste circuit loads OpenQASM as one undoable replace, and refuses junk", () => {
    const c = calc();
    add(c, "h", [0]);
    expect(c.pasteCircuit(["OPENQASM 3.0;", 'include "stdgates.inc";', "qubit[2] q;", "x q[1];"].join("\n"))).toBe(true);
    expect(c.tape.map(formatEntry)).toEqual(["X q1"]);
    c.undo();
    expect(c.tape.map(formatEntry)).toEqual(["H q0"]);
    expect(c.pasteCircuit("not qasm at all")).toBe(false);
    expect(c.pasteCircuit("   ")).toBe(false);
  });
});

describe("Transform menu (Quantiom's), on QC-1's validated circuit tools", () => {
  test("Append U† returns to |0…0⟩; Optimise cancels H·H; each is one UNDO", async () => {
    const c = withTools();
    c.setQubitCount(2);
    add(c, "h", [0]);
    cx(c, 0, 1);
    add(c, "t", [1]);
    c.transform("inverse", { mode: 0 }, "Append U†");
    await Promise.resolve();
    expect(c.transforming).toBeNull();
    expect(c.tape.length).toBe(6);
    expect(probs(stateOf(c))[0]).toBeCloseTo(1, 12);
    c.undo();
    expect(c.tape.length).toBe(3);

    const d = withTools();
    add(d, "h", [0]);
    add(d, "h", [0]);
    add(d, "x", [0]);
    d.transform("simplify", { deep: 0 }, "Optimise");
    await Promise.resolve();
    expect(d.tape.map(formatEntry)).toEqual(["X q0"]);
    expect(d.message?.text).toMatch(/^Optimise: 3 → 1 gates/);
  });

  test("Transpile to Clifford+T keeps the operator (checked by the tool) and uses only its gate set", async () => {
    const c = withTools();
    c.setQubitCount(2);
    add(c, "h", [0]);
    cx(c, 0, 1, "z");
    add(c, "sx", [1]);
    c.transform("transpile", { target: 0 }, "Transpile → Clifford + T");
    await Promise.resolve();
    expect(c.message?.text).toMatch(/same operator/);
    const gates = new Set(c.tape.flat().map((s) => (s.controls.length ? `c${s.gateId}` : s.gateId)));
    for (const g of gates) expect(["h", "s", "sdg", "t", "tdg", "cx", "x", "z", "y"]).toContain(g);
  });

  test("gates a transpile can't rewrite exactly are named in the message", async () => {
    const c = withTools();
    add(c, "ry", [0], { params: ["0.3"] });
    c.transform("transpile", { target: 0 }, "Transpile → Clifford + T");
    await Promise.resolve();
    expect(c.message?.text).toMatch(/Left as is .*ry/);
  });

  test("an empty circuit is refused; Random Clifford replaces it", async () => {
    const c = withTools();
    c.setQubitCount(3);
    expect(c.transform("simplify", { deep: 0 }, "Optimise")).toBe(false);
    expect(c.transform("randclifford", { depth: 2 }, "Random Clifford")).toBe(true);
    await Promise.resolve();
    expect(c.tape.length).toBeGreaterThan(0);
  });
});
