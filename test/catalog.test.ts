import { describe, test, expect } from "vitest";
import { Calculator, type KeyId } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { CATALOG } from "../src/calc/catalog";
import { exportQasm3 } from "../src/qasm/fromTape";

const calc = () => new Calculator(new InlineEngine());
const keys = (c: Calculator, ...ks: KeyId[]) => ks.forEach((k) => c.press(k));
const state = (c: Calculator) => (c.engine as InlineEngine).core.reg.state;
const amp = (c: Calculator, i: number) => [state(c)[2 * i], state(c)[2 * i + 1]];
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);
const idx = (gate: string) => CATALOG.findIndex((it) => it.gate === gate);

/** Open the catalog and walk to `gate` with ▶, as a user would. */
function choose(c: Calculator, gate: string) {
  keys(c, "2nd", "all");
  while (CATALOG[c.catalog.index].gate !== gate) c.press("right");
}

describe("CATALOG", () => {
  test("2ND+ALL opens it; ◀ ▶ scroll and wrap; AC closes without clearing", () => {
    const c = calc();
    keys(c, "x");
    keys(c, "2nd", "all");
    expect(c.catalog.open).toBe(true);
    keys(c, "left");
    expect(c.catalog.index).toBe(c.catalogItems.length - 1);
    keys(c, "right");
    expect(c.catalog.index).toBe(0);
    expect(c.sel).toBe(0); // arrows moved the list, not the qubit
    keys(c, "ac");
    expect(c.catalog.open).toBe(false);
    expect(c.tape).toHaveLength(1);
  });

  test("= applies the highlighted gate to the selected qubit and closes", () => {
    const c = calc();
    choose(c, "gpi");
    keys(c, "pi", "div", "2", "eq"); // GPI(π/2)|0⟩ = e^{iπ/2}|1⟩ = i|1⟩ on q0
    expect(c.catalog.open).toBe(false);
    const [re, im] = amp(c, 2);
    close(re, 0);
    close(im, 1);
  });

  test("tap highlights, second tap applies", () => {
    const c = calc();
    keys(c, "2nd", "all");
    c.pickCatalog(idx("init1"));
    expect(c.tape).toHaveLength(0);
    c.pickCatalog(idx("init1"));
    close(amp(c, 2)[0], 1);
  });

  test("2-qubit catalog gate uses the CTRL mark as partner", () => {
    const c = calc();
    keys(c, "x", "ctrl", "right"); // |10⟩, partner q0, target q1
    choose(c, "dcx");
    keys(c, "eq");
    expect(c.tape[1][0].targets).toEqual([0, 1]);
  });

  test("RCCX needs two marks and flips the target like a Toffoli", () => {
    const c = calc();
    keys(c, "3", "2nd", "q", "x", "right", "x", "ctrl", "left", "ctrl", "right", "right");
    choose(c, "rccx");
    keys(c, "eq");
    const p = [...Array(8).keys()].map((i) => amp(c, i)[0] ** 2 + amp(c, i)[1] ** 2);
    close(p[7], 1); // |110⟩ → |111⟩ (up to a relative phase)
  });

  test("missing partners is an error and the catalog stays open", () => {
    const c = calc();
    choose(c, "rccx");
    keys(c, "eq");
    expect(c.message).toEqual({ kind: "error", text: "CTRL-mark 2 partner qubits first" });
    expect(c.catalog.open).toBe(true);
  });

  test("state prep resets an entangled qubit, then prepares", () => {
    const c = calc();
    keys(c, "h", "ctrl", "right", "x", "left"); // Bell pair, select q0
    choose(c, "initminus");
    keys(c, "eq");
    // q0 is now |−⟩ and q1 collapsed to the reset outcome o: (|0o⟩ − |1o⟩)/√2
    const o = c.tape[2][0].outcome!;
    close(amp(c, o)[0], Math.SQRT1_2);
    close(amp(c, 2 + o)[0], -Math.SQRT1_2);
  });

  test("|ψ⟩ takes α,β, normalises, and matches its QASM (reset; U)", () => {
    const c = calc();
    choose(c, "initialize");
    keys(c, "3", ",", "4", "eq");
    close(amp(c, 0)[0], 0.6);
    close(amp(c, 2)[0], 0.8);
    const q = exportQasm3(c.n, c.tape);
    expect(q).toContain("reset q[0];");
    expect(q).toMatch(/U\(1\.8545\d+, 0, 0\) q\[0\];/);
  });

  test("|ψ⟩ with complex amplitudes drops only the global phase", () => {
    const c = calc();
    choose(c, "initialize");
    keys(c, "0", ",", "1", ",", "1", ",", "0", "eq"); // α = i, β = 1  →  (|0⟩ − i|1⟩)/√2 up to phase
    close(amp(c, 0)[0], Math.SQRT1_2);
    close(amp(c, 2)[1], -Math.SQRT1_2);
  });

  test("state prep can't be controlled", () => {
    const c = calc();
    keys(c, "ctrl", "right");
    choose(c, "init1");
    keys(c, "eq");
    expect(c.message?.kind).toBe("error");
  });
});

describe("custom gates (DEFINE)", () => {
  const openAt = (c: Calculator, gate: string) => {
    keys(c, "2nd", "all");
    const i = c.catalogItems.findIndex((it) => it.gate === gate);
    c.catalog.index = i;
    keys(c, "eq");
  };

  test("DEFINE the last 2 steps as G1, then place G1 elsewhere: same state as the steps", () => {
    const c = calc();
    keys(c, "3", "2nd", "q", "h", "ctrl", "right", "x"); // Bell on q0,q1
    keys(c, "2", "2nd", "all");
    c.catalog.index = c.catalogItems.findIndex((it) => it.gate === "define");
    keys(c, "eq");
    expect(c.customGates.map((d) => [d.name, d.k, d.tape.length])).toEqual([["G1", 2, 2]]);
    // Place G1 on (q1, q2): mark q1 as partner, target q2.
    keys(c, "undo", "undo"); // empty tape; q1 selected
    keys(c, "ctrl", "right"); // partner q1, target q2
    openAt(c, "custom:G1");
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
    keys(c, "2nd", ".", "rx"); // RX(t) on q0
    keys(c, "2nd", "all");
    c.catalog.index = c.catalogItems.findIndex((it) => it.gate === "define");
    keys(c, "eq");
    keys(c, "undo");
    keys(c, "ctrl", "right"); // control q0, target q1
    openAt(c, "custom:G1");
    const q = exportQasm3(c.n, c.tape);
    expect(q).toContain("gate G1(p0) a0 { rx(p0) a0; }");
    expect(q).toContain("ctrl @ G1(t_) q[0], q[1];");
    expect(c.symbols).toEqual(["t"]);
  });
});

describe("IF (2ND+Z): one-shot classical condition", () => {
  test("teleportation corrections: X if c1, Z if c0 — q2 ends in the input state", () => {
    for (let trial = 0; trial < 6; trial++) {
      const c = calc();
      keys(c, "3", "2nd", "q");
      // Input on q0: RY(0.8)
      keys(c, "0", ".", "8", "ry");
      keys(c, "right", "h", "ctrl", "right", "x"); // Bell pair q1,q2 (sel ends on q2)
      keys(c, "left", "left", "ctrl", "right", "x"); // CX q0→q1
      keys(c, "left", "h", "meas", "right", "meas"); // measure q0, q1
      keys(c, "right", "1", "2nd", "z");
      expect(c.pendingIf).toEqual({ clbit: 1, value: 1 });
      keys(c, "x");
      expect(c.pendingIf).toBeNull();
      keys(c, "0", "2nd", "z", "z");
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
    keys(c, "h", "meas", "right", "0", "2nd", "z", "x");
    const q = exportQasm3(c.n, c.tape);
    expect(q).toContain("c[0] = measure q[0];");
    expect(q).toContain("if (c[0] == true) x q[1];");
  });
});
