import { describe, test, expect, vi } from "vitest";
import { Calculator } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { calc, add, cx } from "./ed";
import { Register } from "../src/calc/register";
import { exportQasm3 } from "../src/qasm/fromTape";

const state = (c: Calculator) => (c.engine as InlineEngine).core.reg.state;
const p1 = (c: Calculator) => state(c)[2] ** 2 + state(c)[3] ** 2; // P(q0 = 1) on n = 1

describe("symbols", () => {
  test("a symbolic rotation defines the symbol at 0 and follows its value", () => {
    const c = calc();
    c.setQubitCount(1);
    add(c, "rx", [0], { params: ["θ"] }); // RX(θ)
    expect(c.symbols).toEqual(["theta"]);
    expect(c.scope.theta).toBe(0);
    expect(p1(c)).toBeCloseTo(0, 12);
    c.setSymbol("theta", Math.PI);
    expect(p1(c)).toBeCloseTo(1, 12);
    c.setSymbol("theta", Math.PI / 2);
    expect(p1(c)).toBeCloseTo(0.5, 12);
  });

  test("the PARAM screen sets a symbol's value", () => {
    const c = calc();
    c.setQubitCount(1);
    add(c, "ry", [0], { params: ["θ"] });
    c.openParams();
    expect(c.param.open).toBe(true);
    c.setSymbol(c.symbols[c.param.index], Math.PI);
    expect(c.scope.theta).toBeCloseTo(Math.PI, 12);
    expect(p1(c)).toBeCloseTo(1, 12);
    c.closeParams();
    expect(c.param.open).toBe(false);
  });

  test("a measurement made impossible by a new value is re-sampled, with a note", () => {
    const c = calc();
    c.setQubitCount(1);
    add(c, "rx", [0], { params: ["θ"] }); // RX(θ)
    c.setSymbol("theta", Math.PI);
    add(c, "measure", [0]); // certainly 1
    expect(c.tape[1][0].outcome).toBe(1);
    c.setSymbol("theta", 0); // outcome 1 now impossible
    expect(c.tape[1][0].outcome).toBe(0);
    expect(c.message?.text).toMatch(/changed 1→0/);
    expect(p1(c)).toBeCloseTo(0, 12);
  });

  test("scope survives save/restore", () => {
    const c = calc();
    c.setQubitCount(1);
    add(c, "rx", [0], { params: ["θ"] });
    c.setSymbol("theta", 1.25);
    const d = new Calculator(new InlineEngine(), JSON.parse(JSON.stringify(c.save())));
    expect(d.scope.theta).toBe(1.25);
    expect(Array.from(state(d))).toEqual(Array.from(state(c)));
  });

  test("symbols export as input floats, t renamed", () => {
    const c = calc();
    add(c, "rz", [0], { params: ["t"] });
    add(c, "rx", [1], { params: ["2*θ"] });
    const q = exportQasm3(c.n, c.tape);
    expect(q).toContain("input float t_;");
    expect(q).toContain("input float theta;");
    expect(q).toContain("rz(t_) q[0];");
    expect(q).toContain("rx(2*theta) q[1];");
  });

  test("playback advances t in wall-clock time, pulled by views", () => {
    vi.useFakeTimers();
    const c = calc();
    c.setQubitCount(1);
    add(c, "rx", [0], { params: ["t"] });
    c.togglePlayback("t", 1); // one turn per second
    for (let i = 0; i < 30; i++) vi.advanceTimersByTime(16);
    expect(c.scope.t).toBeGreaterThan(0.3);
    expect(c.scope.t).toBeLessThan(2 * Math.PI);
    c.stopPlayback();
    const t = c.scope.t;
    vi.advanceTimersByTime(500);
    expect(c.scope.t).toBe(t);
    vi.useRealTimers();
  });
});

describe("memory and whole-tape undo", () => {
  test("STO / RCL, and UNDO brings the previous tape back", () => {
    const c = calc();
    add(c, "h", [0]);
    expect(c.store(3)).toBe(true);
    expect(c.memory[3].tape).toHaveLength(1);
    add(c, "x", [0]);
    add(c, "y", [0]);
    expect(c.recall(3)).toBe(true);
    expect(c.tape).toHaveLength(1);
    c.undo();
    expect(c.tape).toHaveLength(3);
    c.redo();
    expect(c.tape).toHaveLength(1);
  });

  test("RCL of an empty slot is an error", () => {
    const c = calc();
    expect(c.recall(7)).toBe(false);
    expect(c.message).toEqual({ kind: "error", text: "M7 is empty" });
  });

  test("clearing the circuit is undoable", () => {
    const c = calc();
    add(c, "h", [0]);
    cx(c, 0, 1);
    c.clearCircuit();
    expect(c.tape).toHaveLength(0);
    c.undo();
    expect(c.tape).toHaveLength(2);
  });

  test("entry undo after a replace walks back correctly", () => {
    const r = new Register(2);
    const s = (g: string) => [{ id: g, gateId: g, column: 0, targets: [0], controls: [], clbits: [], params: [] }];
    r.push(s("x"));
    r.replace({ n: 2, tape: [s("h")], scope: {} }, "RCL");
    r.push(s("z"));
    r.undo(); // z
    expect(r.tape.map((e) => e[0].gateId)).toEqual(["h"]);
    r.undo(); // the replace
    expect(r.tape.map((e) => e[0].gateId)).toEqual(["x"]);
    r.redo();
    r.redo();
    expect(r.tape.map((e) => e[0].gateId)).toEqual(["h", "z"]);
  });
});

test("tape labels drop the implicit ×", async () => {
  const { prettyExpr } = await import("../src/calc/steps");
  expect(prettyExpr("2*θ+π/4")).toBe("2θ+π÷4");
  expect(prettyExpr("3*π/4")).toBe("3π÷4");
  expect(prettyExpr("π*t")).toBe("πt");
  expect(prettyExpr("θ*t")).toBe("θ×t");
});
