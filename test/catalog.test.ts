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
    expect(c.catalog.index).toBe(CATALOG.length - 1);
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
