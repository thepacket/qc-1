import { describe, test, expect } from "vitest";
import { calc, add, stateOf } from "./ed";
import { PALETTE } from "../src/calc/gateSpecs";
import { layoutTape } from "../src/calc/diagram";
import { exportQasm3 } from "../src/qasm/fromTape";
import { importQasm } from "../src/qasm/import";
import { qiskitPython } from "../src/qasm/toQiskit";
import { Register } from "../src/calc/register";
import { StabilizerRegister } from "../src/stab/register";
import { bitCount, formatEntry, measuredBit, type Step } from "../src/calc/steps";

const tile = (id: string) => PALETTE.find((p) => p.id === id)!;
const probs = (st: Float64Array) => Array.from({ length: st.length / 2 }, (_, i) => st[2 * i] ** 2 + st[2 * i + 1] ** 2);

describe("a classical register of its own (Quantiom's)", () => {
  test("a measurement writes its own bit; without one, its qubit's (c[q], QC-1's first convention)", () => {
    const m = (q: number, clbits: number[] = []): Step => ({ id: "m", gateId: "measure", column: 0, targets: [q], controls: [], clbits, params: [] });
    expect(measuredBit(m(1))).toBe(1);
    expect(measuredBit(m(1, [3]))).toBe(3);
    expect(bitCount(2, [[m(0, [4])]])).toBe(5);
    expect(bitCount(3, [[m(0)]], 1)).toBe(1);
    expect(formatEntry([m(0, [2])])).toBe("M q0→c2");
    expect(formatEntry([m(0, [0])])).toBe("M q0");
  });

  test("measure q1 into c0, then IF c0 flips q2: the bit, not the qubit, is the control line", () => {
    const c = calc();
    c.setQubitCount(3);
    add(c, "x", [1]);
    c.placeItem(tile("measure"), 1, 1); // lands on q1, writing c1 (its own qubit's)
    const mi = c.tape.findIndex((e) => e[0].gateId === "measure");
    expect(c.setMeasureBit(mi, 0)).toBe(true);
    expect(c.tape[mi][0].clbits).toEqual([0]);
    add(c, "x", [2], { condition: { clbit: 0, value: 1 } });
    expect(probs(stateOf(c))[0b110]).toBeCloseTo(1, 12); // |q2 q1 q0⟩ = |110⟩
    expect(Array.from((c.engine as unknown as { core: { reg: Register } }).core.reg.cbits.slice(0, 2))).toEqual([1, 0]);
  });

  test("the count: bits beyond the qubits, never below a bit in use; measurements default to their qubit's bit or the last", () => {
    const c = calc();
    c.setQubitCount(3);
    expect(c.setClassicalCount(5)).toBe(true);
    expect(c.bits).toBe(5);
    c.placeItem(tile("measure"), 2, 0);
    expect(measuredBit(c.tape[0][0])).toBe(2);
    expect(c.setMeasureBit(0, 4)).toBe(true);
    expect(c.setClassicalCount(4)).toBe(false); // c4 is in use: refused, quietly
    expect(c.message?.kind).not.toBe("error");
    expect(c.bits).toBe(5);
    expect(c.usedBits).toBe(5);
    expect(c.setMeasureBit(0, 1)).toBe(true);
    expect(c.setClassicalCount(2)).toBe(true);
    const d = calc();
    d.setQubitCount(3);
    d.setClassicalCount(1);
    d.placeItem(tile("measure"), 2, 0);
    expect(measuredBit(d.tape[0][0])).toBe(0); // the register has one bit: the measurement writes c0
    expect(d.save().nc).toBe(1);
  });

  test("OpenQASM round trip: bit[m] c, c[j] = measure q[i], if (c[j] == …)", () => {
    const c = calc();
    c.setQubitCount(2);
    c.setClassicalCount(3);
    add(c, "h", [0]);
    c.placeItem(tile("measure"), 0, 1);
    c.setMeasureBit(1, 2);
    add(c, "x", [1], { condition: { clbit: 2, value: 1 } });
    const q = exportQasm3(c.n, c.tape, c.bits);
    expect(q).toContain("bit[3] c;");
    expect(q).toContain("c[2] = measure q[0];");
    expect(q).toContain("if (c[2] == true) x q[1];");
    const r = importQasm(q);
    expect(r.nc).toBe(3);
    expect(r.tape.map(formatEntry)).toEqual(c.tape.map(formatEntry));
    expect(qiskitPython(c.n, c.tape, c.bits)).toContain("qc.measure(qr[0], cr[2])");
  });

  test("loading a program sets the count from its bit registers", () => {
    const c = calc();
    c.loadQasm(`OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; bit[4] a; bit[1] b; h q[0]; b[0] = measure q[0];`, "t");
    expect(c.nc).toBe(5);
    expect(c.tape[1][0].clbits).toEqual([4]);
  });

  test("stabilizer mode writes the same bits", () => {
    const tape = [[{ id: "h", gateId: "h", column: 0, targets: [0], controls: [], clbits: [], params: [] }],
      [{ id: "m", gateId: "measure", column: 0, targets: [0], controls: [], clbits: [3], params: [], outcome: 1 as const }],
      [{ id: "x", gateId: "x", column: 0, targets: [22], controls: [], clbits: [], params: [], condition: { clbit: 3, value: 1 } }]];
    const reg = new StabilizerRegister(24, tape);
    expect(reg.cbits[3]).toBe(1);
    expect(reg.cbits.length).toBe(24);
    // IF c3 flipped q22: measuring it (into c5) gives 1 for certain.
    const done = reg.push([{ id: "m2", gateId: "measure", column: 0, targets: [22], controls: [], clbits: [5], params: [] }]);
    expect(done[0].outcome).toBe(1);
    expect(reg.cbits[5]).toBe(1);
  });

  test("the diagram keeps a measurement's column free down to the bus; IF waits for the bit, not the qubit", () => {
    const m: Step = { id: "m", gateId: "measure", column: 0, targets: [0], controls: [], clbits: [1], params: [] };
    const y: Step = { id: "y", gateId: "y", column: 0, targets: [2], controls: [], clbits: [], params: [] };
    const ifx: Step = { id: "i", gateId: "x", column: 0, targets: [2], controls: [], clbits: [], params: [], condition: { clbit: 1, value: 1 } };
    const hq0: Step = { id: "h", gateId: "h", column: 0, targets: [0], controls: [], clbits: [], params: [] };
    const lay = layoutTape(3, [[m], [y], [hq0], [ifx]]);
    const col = (id: string) => lay.items.find((it) => it.step.id === id)!.col;
    expect(col("m")).toBe(0);
    expect(col("y")).toBe(1); // q2 is below the measurement's link in column 0
    expect(col("h")).toBe(1); // q0 itself is free after the measurement
    expect(col("i")).toBe(2); // after the measurement that wrote c1, and after Y on q2
  });
});
