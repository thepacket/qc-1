import { describe, test, expect } from "vitest";
import { matrixGate, parseComplex, parseMatrix, parseState, stateGate } from "../src/calc/typed";
import { setCustomGates, CUSTOM_PREFIX } from "../src/calc/custom";
import { applyStep } from "../src/calc/steps";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 12);

describe("typed entry: parsing", () => {
  test.each([
    ["0.5", [0.5, 0]], ["-i", [0, -1]], ["2i", [0, 2]], ["1/√2", [Math.SQRT1_2, 0]], ["0.3+0.4i", [0.3, 0.4]],
    ["(1-i)/2", [0.5, -0.5]], ["sqrt(3)/2 - 0.5i", [Math.sqrt(3) / 2, -0.5]], ["cos(pi/8)", [Math.cos(Math.PI / 8), 0]], ["−1", [-1, 0]],
  ] as const)("complex %s", (t, [re, im]) => {
    const c = parseComplex(t)!;
    close(c[0], re);
    close(c[1], im);
  });

  test("kets: sums with coefficients, an overall factor, labels, amplitude lists", () => {
    const bell = parseState("(|00⟩ + |11⟩)/√2");
    expect(bell.k).toBe(2);
    [Math.SQRT1_2, 0, 0, Math.SQRT1_2].forEach((x, i) => close(bell.re[i], x));
    const s = parseState("(1+i)|01> - 0.5i|10⟩");
    const n = Math.sqrt(2 + 0.25);
    close(s.re[1], 1 / n); close(s.im[1], 1 / n); close(s.im[2], -0.5 / n);
    expect(parseState("011").re[3]).toBe(1);
    const a = parseState("1, 0, 0, i");
    close(a.im[3], Math.SQRT1_2);
    expect(() => parseState("|0⟩ + |11⟩")).toThrow(/same number/);
    expect(() => parseState("|00⟩ + banana")).toThrow();
    expect(() => parseState("0, 0")).toThrow(/zero/);
  });

  test("matrices: rows by ; or new lines; unitarity to 1e-3, then made exact", () => {
    const h = parseMatrix("0.7071, 0.7071; 0.7071, -0.7071");
    expect(h.k).toBe(1);
    expect(h.drift).toBeGreaterThan(1e-5);
    close(h.U[0][0].re, Math.SQRT1_2);
    expect(parseMatrix("1,0,0,0\n0,1,0,0\n0,0,0,i\n0,0,i,0").k).toBe(2);
    expect(() => parseMatrix("1, 1; 0, 1")).toThrow(/not unitary/);
    expect(() => parseMatrix("1, 0, 0; 0, 1, 0; 0, 0, 1")).toThrow(/rows/);
  });
});

describe("typed entry: gates are exact, global phase included", () => {
  const op = (g: ReturnType<typeof matrixGate>) => {
    setCustomGates([g]);
    const d = 1 << g.k;
    return Array.from({ length: d }, (_, j) => {
      const st = new Float64Array(2 * d);
      st[2 * j] = 1;
      applyStep(st, g.k, { id: "x", gateId: CUSTOM_PREFIX + g.name, column: 0, targets: [...Array(g.k).keys()], controls: [], clbits: [], params: [] }, Math.random, {});
      return st;
    });
  };

  test("a phased 1-qubit matrix, CZ·(S⊗1), and a 3-qubit permutation with phases", () => {
    for (const text of [
      "0.6i, 0.8; -0.8, -0.6i",
      "1, 0, 0, 0; 0, 1, 0, 0; 0, 0, i, 0; 0, 0, 0, -i",
      "0,0,0,0,0,0,0,1; 1,0,0,0,0,0,0,0; 0,i,0,0,0,0,0,0; 0,0,1,0,0,0,0,0; 0,0,0,-1,0,0,0,0; 0,0,0,0,1,0,0,0; 0,0,0,0,0,-i,0,0; 0,0,0,0,0,0,1,0",
    ]) {
      const m = parseMatrix(text);
      const V = op(matrixGate("M1", m));
      m.U.forEach((row, i) => row.forEach((z, j) => { close(V[j][2 * i], z.re); close(V[j][2 * i + 1], z.im); }));
    }
  });

  test("PSI maps |0…0⟩ to the typed state exactly", () => {
    for (const text of ["(|00⟩ + i|11⟩)/√2", "0.6|001⟩ - 0.8i|110⟩", "1, 2, 3i, -1"]) {
      const st = parseState(text);
      const col = op(stateGate("PSI1", st))[0];
      st.re.forEach((x, i) => { close(col[2 * i], x); close(col[2 * i + 1], st.im[i]); });
    }
  });
});

import { Calculator } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { formatEntry } from "../src/calc/steps";

describe("typed entry in the calculator", () => {
  const openTyped = (c: Calculator, label: string) => {
    c.press("2nd"); c.press("all");
    const i = c.catalogItems.findIndex((it) => it.label === label);
    c.pickCatalog(i);
    c.pickCatalog(i);
    expect(c.catalog.typing).not.toBeNull();
  };

  test("STATE… resets and prepares on q0…; the KET is the typed state", () => {
    const c = new Calculator(new InlineEngine());
    c.press("x"); // q0 = |1⟩: the reset must clear it
    openTyped(c, "STATE…");
    c.enterTyped("(|00⟩ + i|11⟩)/√2");
    expect(c.catalog.open).toBe(false);
    expect(c.tape.slice(-2).map(formatEntry)).toEqual(["RST q0 RST q1", "PSI1 q0,q1"]);
    const v = c.view!;
    if (v.mode !== "ket") throw new Error(v.mode);
    const rows = v.rows.filter((r) => r.re ** 2 + r.im ** 2 > 1e-12);
    expect(rows.map((r) => r.i)).toEqual([0, 3]);
    expect(rows[1].im).toBeCloseTo(Math.SQRT1_2, 12);
  });

  test("MATRIX… on CTRL-marked qubits; a bad matrix throws and leaves the field open", () => {
    const c = new Calculator(new InlineEngine());
    c.press("3"); c.press("2nd"); c.press("q");
    c.press("ctrl"); c.press("right"); c.press("right"); // mark q0, select q2
    openTyped(c, "MATRIX…");
    expect(() => c.enterTyped("1, 1; 0, 1")).toThrow(/not unitary/);
    expect(c.catalog.typing).toBe("matrix");
    c.enterTyped("1,0,0,0; 0,0,1,0; 0,1,0,0; 0,0,0,1");
    expect(formatEntry(c.tape.at(-1)!)).toBe("M1 q0,q2");
  });
});
