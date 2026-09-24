import { describe, test, expect } from "vitest";
import { Calculator } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { Register } from "../src/calc/register";
import { formatStep } from "../src/calc/steps";
import { calc, add, cx, stateOf } from "./ed";

const amp = (c: Calculator, i: number) => [stateOf(c)[2 * i], stateOf(c)[2 * i + 1]];
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);

describe("calculator", () => {
  test("Bell state: H q0, CTRL q0, q1, X", () => {
    const c = calc();
    add(c, "h", [0]);
    cx(c, 0, 1);
    close(amp(c, 0)[0], Math.SQRT1_2);
    close(amp(c, 3)[0], Math.SQRT1_2);
    close(amp(c, 1)[0], 0);
    expect(formatStep(c.tape[1][0])).toBe("CX q0→q1");
  });

  test("anti-control fires on |0⟩", () => {
    const c = calc();
    add(c, "x", [1], { controls: [0], controlStates: [false] }); // ○X q0→q1 on |00⟩ → |01⟩
    close(amp(c, 1)[0], 1);
  });

  test("rotation takes its angle", () => {
    const c = calc();
    add(c, "rx", [0], { params: ["pi"] }); // RX(π)|0⟩ = −i|1⟩
    const [re, im] = amp(c, 2);
    close(re, 0);
    close(im, -1);
  });

  test("U takes three args", () => {
    const c = calc();
    add(c, "u", [0], { params: ["pi", "0", "pi"] }); // U(π,0,π) = X
    close(amp(c, 2)[0], 1);
  });

  test("ALL applies to every qubit as one undo unit", () => {
    const c = calc();
    c.setQubitCount(3);
    c.addBroadcast("h");
    for (let i = 0; i < 8; i++) close(amp(c, i)[0], 1 / Math.sqrt(8));
    c.undo();
    close(amp(c, 0)[0], 1);
    expect(c.tape).toHaveLength(0);
  });

  test("SWAP exchanges its two qubits", () => {
    const c = calc();
    add(c, "x", [0]);
    add(c, "swap", [0, 1]); // |10⟩ → |01⟩
    close(amp(c, 1)[0], 1);
  });

  test("measurement collapses and replays deterministically on undo", () => {
    const c = calc();
    add(c, "h", [0]);
    cx(c, 0, 1);
    add(c, "measure", [1]);
    add(c, "h", [1]);
    const o = c.tape[2][0].outcome!;
    const collapsed = o === 1 ? 3 : 0;
    c.undo();
    close(amp(c, collapsed)[0], 1);
    c.redo();
    expect(c.tape[3][0].outcome).toBeUndefined();
  });

  test("resize keeps the state and refuses to drop a used qubit", () => {
    const c = calc();
    add(c, "x", [1]);
    c.setQubitCount(3); // |01⟩ → n=3 → |010⟩
    close(amp(c, 2)[0], 1);
    c.setQubitCount(2);
    c.setQubitCount(1);
    expect(c.n).toBe(2);
    expect(c.message?.kind).toBe("error");
  });

  test("errors leave the state alone", () => {
    const c = calc();
    expect(add(c, "swap", [0])).toBe(false);
    expect(c.message).toEqual({ kind: "error", text: "SWAP acts on 2 qubits" });
    expect(c.tape).toHaveLength(0);
  });

  test("duplicate repeats a gate", () => {
    const c = calc();
    add(c, "t", [0]);
    for (let i = 0; i < 3; i++) c.duplicateGate(c.tape.length - 1);
    add(c, "h", [0]);
    // T⁴ = Z; H Z |0⟩ ... Z|0⟩ = |0⟩ so H gives |+⟩
    close(amp(c, 0)[0], Math.SQRT1_2);
    expect(c.tape).toHaveLength(5);
  });

  test("save/restore round-trips", () => {
    const c = calc();
    add(c, "h", [0]);
    cx(c, 0, 1);
    add(c, "measure", [1]);
    const d = calc(JSON.parse(JSON.stringify(c.save())));
    expect(Array.from(stateOf(d))).toEqual(Array.from(stateOf(c)));
  });
});

describe("register snapshots", () => {
  test("undo matches a fresh replay at larger n", () => {
    const r = new Register(12);
    const mk = (g: string, t: number, ctrl: number[] = []) => [
      { id: "x", gateId: g, column: 0, targets: [t], controls: ctrl, clbits: [], params: g === "rz" ? ["0.3"] : [] },
    ];
    for (let i = 0; i < 40; i++) r.push(mk(["h", "rz", "x"][i % 3], i % 12, i % 5 === 0 ? [(i + 1) % 12] : []));
    const expected = new Register(12, r.tape.slice(0, 33));
    for (let i = 0; i < 7; i++) r.undo();
    for (let i = 0; i < r.state.length; i++) expect(r.state[i]).toBeCloseTo(expected.state[i], 12);
  });
});

describe("fast single-target kernel", () => {
  test("matches the generic path for random controlled gates", async () => {
    const { applyKQubit } = await import("../src/sim/apply");
    const { buildMatrix, controlled, M_X } = await import("../src/sim/matrices");
    const { applyControlled1 } = await import("../src/calc/steps");
    const n = 5;
    const rnd = new Float64Array(2 << n).map(() => Math.random() - 0.5);
    const cases: [string, string[], number[], boolean[] | undefined, number][] = [
      ["h", [], [], undefined, 2],
      ["rx", ["0.7"], [0], undefined, 3],
      ["u", ["0.3", "1.1", "-0.4"], [4, 1], [true, false], 0],
      ["y", [], [1, 2, 3], [false, false, true], 4],
    ];
    for (const [g, ps, cs, st, t] of cases) {
      const U = buildMatrix(g, ps.map(Number))!;
      const a = rnd.slice(), b = rnd.slice();
      applyControlled1(a, n, cs, st, t, U);
      const anti = cs.filter((_, i) => st?.[i] === false);
      for (const q of anti) applyKQubit(b, n, [q], M_X);
      applyKQubit(b, n, [...cs, t], cs.length ? controlled(U, cs.length) : U);
      for (const q of anti) applyKQubit(b, n, [q], M_X);
      for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 12);
    }
  });
});

describe("engine protocol", () => {
  test("replies are reported in order when commands queue up", () => {
    // A deferred engine: nothing is answered until flush().
    class Deferred extends InlineEngine {
      queue: Parameters<InlineEngine["send"]>[0][] = [];
      send(cmd: Parameters<InlineEngine["send"]>[0]) { this.queue.push(cmd); }
      flush() { for (const c of this.queue.splice(0)) super.send(c); }
    }
    const eng = new Deferred();
    const c = new Calculator(eng);
    add(c, "h", [0]);
    add(c, "x", [1]);
    c.undo();
    expect(c.tape).toHaveLength(0); // mirror not updated yet
    eng.flush();
    expect(c.tape).toHaveLength(1);
    expect(c.message?.text).toBe("undo X q1");
  });

  test("a gate racing a shrink is rejected, not applied out of range", () => {
    class Deferred extends InlineEngine {
      queue: Parameters<InlineEngine["send"]>[0][] = [];
      send(cmd: Parameters<InlineEngine["send"]>[0]) { this.queue.push(cmd); }
      flush() { for (const c of this.queue.splice(0)) super.send(c); }
    }
    const eng = new Deferred();
    const c = new Calculator(eng);
    c.setQubitCount(3);
    eng.flush();
    c.setQubitCount(2);
    // X on q2 before the shrink's reply: the UI still sees n = 3, so only the core can refuse it.
    expect(add(c, "x", [2])).toBe(true);
    eng.flush();
    expect(c.n).toBe(2);
    expect(c.tape).toHaveLength(0);
    expect(c.message).toEqual({ kind: "error", text: "no q2 (n=2)" });
  });

  test("view summaries follow the selected mode", () => {
    const c = calc();
    add(c, "h", [0]);
    cx(c, 0, 1);
    expect(c.view?.mode).toBe("ket");
    c.setMode("bloch");
    expect(c.view?.mode).toBe("bloch");
    if (c.view?.mode === "bloch") expect(c.view.vectors).toHaveLength(2);
    c.setMode("shots");
    if (c.view?.mode === "shots") expect(c.view.rows.map((r) => r.i).sort()).toEqual([0, 3]);
  });

  test("bad saved session falls back to a fresh register with an error", () => {
    const c = calc({ v: 1, n: 2, sel: 0, mode: "ket", shots: 10, tape: [[{ id: "a", gateId: "nope", column: 0, targets: [0], controls: [], clbits: [], params: [] }]] });
    expect(c.message?.kind).toBe("error");
    expect(c.tape).toHaveLength(0);
  });
});
