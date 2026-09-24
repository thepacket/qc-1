import { describe, test, expect } from "vitest";
import { Calculator } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { exportQasm3 } from "../src/qasm/fromTape";
import { formatStep } from "../src/calc/steps";
import { calc, add, cx, stateOf as state } from "./ed";

const amp = (c: Calculator, i: number) => [state(c)[2 * i], state(c)[2 * i + 1]];
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);

describe("gates without their own key", () => {
  test("GPI takes its angle", () => {
    const c = calc();
    add(c, "gpi", [0], { params: ["pi/2"] }); // GPI(π/2)|0⟩ = e^{iπ/2}|1⟩ = i|1⟩ on q0
    const [re, im] = amp(c, 2);
    close(re, 0);
    close(im, 1);
  });

  test("INIT1 prepares |1⟩", () => {
    const c = calc();
    add(c, "init1", [0]);
    close(amp(c, 2)[0], 1);
  });

  test("a 2-qubit gate keeps its qubit order", () => {
    const c = calc();
    add(c, "x", [0]); // |10⟩
    add(c, "dcx", [0, 1]);
    expect(c.tape[1][0].targets).toEqual([0, 1]);
  });

  test("RCCX takes three qubits and flips the target like a Toffoli", () => {
    const c = calc();
    c.setQubitCount(3);
    add(c, "x", [0]);
    add(c, "x", [1]);
    add(c, "rccx", [0, 1, 2]);
    const p = [...Array(8).keys()].map((i) => amp(c, i)[0] ** 2 + amp(c, i)[1] ** 2);
    close(p[7], 1); // |110⟩ → |111⟩ (up to a relative phase)
  });

  test("the wrong number of qubits is an error", () => {
    const c = calc();
    c.setQubitCount(3);
    expect(add(c, "rccx", [2])).toBe(false);
    expect(c.message).toEqual({ kind: "error", text: "RCCX acts on 3 qubits" });
    expect(c.tape).toHaveLength(0);
  });

  test("state prep resets an entangled qubit, then prepares", () => {
    const c = calc();
    add(c, "h", [0]);
    cx(c, 0, 1); // Bell pair
    add(c, "initminus", [0]);
    // q0 is now |−⟩ and q1 collapsed to the reset outcome o: (|0o⟩ − |1o⟩)/√2
    const o = c.tape[2][0].outcome!;
    close(amp(c, o)[0], Math.SQRT1_2);
    close(amp(c, 2 + o)[0], -Math.SQRT1_2);
  });

  test("|ψ⟩ takes α,β, normalises, and matches its QASM (reset; U)", () => {
    const c = calc();
    add(c, "initialize", [0], { params: ["3", "4"] });
    close(amp(c, 0)[0], 0.6);
    close(amp(c, 2)[0], 0.8);
    const q = exportQasm3(c.n, c.tape);
    expect(q).toContain("reset q[0];");
    expect(q).toMatch(/U\(1\.8545\d+, 0, 0\) q\[0\];/);
  });

  test("|ψ⟩ with complex amplitudes drops only the global phase", () => {
    const c = calc();
    add(c, "initialize", [0], { params: ["i", "1"] }); // α = i, β = 1  →  (|0⟩ − i|1⟩)/√2 up to phase
    close(amp(c, 0)[0], Math.SQRT1_2);
    close(amp(c, 2)[1], -Math.SQRT1_2);
  });

  test("state prep can't be controlled", () => {
    const c = calc();
    expect(add(c, "init1", [1], { controls: [0] })).toBe(false);
    expect(c.message).toEqual({ kind: "error", text: "a measurement, reset or preparation can't be controlled" });
  });
});

describe("custom gates (DEFINE)", () => {
  test("DEFINE the last 2 steps as G1, then place G1 elsewhere: same state as the steps", () => {
    const c = calc();
    c.setQubitCount(3);
    add(c, "h", [0]);
    cx(c, 0, 1); // Bell on q0,q1
    expect(c.defineGate(2)).toBe("G1");
    expect(c.customGates.map((d) => [d.name, d.k, d.tape.length])).toEqual([["G1", 2, 2]]);
    // Place G1 on (q1, q2).
    c.undo();
    c.undo(); // empty tape
    add(c, "custom:G1", [1, 2]);
    expect(c.tape).toHaveLength(1);
    expect(c.tape[0][0].targets).toEqual([1, 2]);
    const v = c.view!;
    if (v.mode !== "ket") throw new Error(v.mode);
    expect(v.rows.map((r) => r.i).sort()).toEqual([0b000, 0b011]);
    // Exported as a gate definition and one call.
    const q = exportQasm3(c.n, c.tape);
    expect(q).toContain("gate G1 a0, a1 { h a0; cx a0, a1; }");
    expect(q).toContain("G1 q[1], q[2];");
    // Persisted with the session.
    expect(c.save().gates?.[0].name).toBe("G1");
  });

  test("a controlled custom gate, and a custom gate with a symbol, export with ctrl @ and a parameter", () => {
    const c = calc();
    add(c, "rx", [0], { params: ["t"] }); // RX(t) on q0
    expect(c.defineGate()).toBe("G1");
    c.undo();
    add(c, "custom:G1", [1], { controls: [0] }); // control q0, target q1
    const q = exportQasm3(c.n, c.tape);
    expect(q).toContain("gate G1(p0) a0 { rx(p0) a0; }");
    expect(q).toContain("ctrl @ G1(t_) q[0], q[1];");
    expect(c.symbols).toEqual(["t"]);
  });
});

describe("IF: classical condition", () => {
  test("teleportation corrections: X if c1, Z if c0 — q2 ends in the input state", () => {
    for (let trial = 0; trial < 6; trial++) {
      const c = calc();
      c.setQubitCount(3);
      // Input on q0: RY(0.8)
      add(c, "ry", [0], { params: ["0.8"] });
      add(c, "h", [1]);
      cx(c, 1, 2); // Bell pair q1,q2
      cx(c, 0, 1); // CX q0→q1
      add(c, "h", [0]);
      add(c, "measure", [0]);
      add(c, "measure", [1]); // measure q0, q1
      add(c, "x", [2], { condition: { clbit: 1, value: 1 } });
      expect(c.tape[c.tape.length - 1][0].condition).toEqual({ clbit: 1, value: 1 });
      add(c, "z", [2], { condition: { clbit: 0, value: 1 } });
      const last = c.tape[c.tape.length - 1][0];
      expect(last.condition).toEqual({ clbit: 0, value: 1 });
      // q2's reduced state is RY(0.8)|0⟩ whatever was measured.
      const st = (c.engine as InlineEngine).core.reg.state;
      let p1 = 0;
      for (let i = 0; i < 8; i++) if (i & 1) p1 += st[2 * i] ** 2 + st[2 * i + 1] ** 2;
      expect(p1).toBeCloseTo(Math.sin(0.4) ** 2, 10);
    }
  });

  test("the QASM export writes c[q] and if (c[k] == true)", () => {
    const c = calc();
    add(c, "h", [0]);
    add(c, "measure", [0]);
    add(c, "x", [1], { condition: { clbit: 0, value: 1 } });
    const q = exportQasm3(c.n, c.tape);
    expect(q).toContain("c[0] = measure q[0];");
    expect(q).toContain("if (c[0] == true) x q[1];");
  });
});

describe("algorithm blocks", () => {
  test("QFT on the register is one step; QFT† undoes it", () => {
    const c = calc();
    c.setQubitCount(3);
    add(c, "x", [0]);
    expect(c.addBlock("qft", [0, 1, 2])).toBe(true);
    expect(c.tape.at(-1)!.map(formatStep)).toEqual(["QFT3 q0,q1,q2"]);
    c.addBlock("iqft", [0, 1, 2]);
    const v = c.view!;
    if (v.mode !== "ket") throw new Error(v.mode);
    expect(v.rows.filter((r) => r.re ** 2 + r.im ** 2 > 1e-12).map((r) => r.i)).toEqual([4]); // back to |100⟩
  });

  test("a block's qubits go in ascending order; QAOA takes γ,β as two steps", () => {
    const c = calc();
    c.setQubitCount(4);
    c.addBlock("diff", [3, 0, 2]);
    expect(c.tape.at(-1)![0].targets).toEqual([0, 2, 3]);
    c.addBlock("qaoa", [0, 1, 2, 3], ["π/8", "π/4"]);
    expect(c.tape.slice(-2).map((e) => e.map((s) => s.gateId))).toEqual([["rzz", "rzz", "rzz", "rzz"], ["rx", "rx", "rx", "rx"]]);
    expect(c.tape.at(-2)![0].params[0]).toBe("2*(π/8)");
  });
});
