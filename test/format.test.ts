import { describe, test, expect } from "vitest";
import { InlineEngine } from "../src/calc/engine";
import { calc, add, cx } from "./ed";
import { bloch, topK } from "../src/calc/analysis";
import { complex, pct } from "../src/ui/format";

/** 1-qubit gates on q0, in order. */
const run = (...gates: string[]) => {
  const c = calc();
  gates.forEach((g) => add(c, g, [0]));
  return c;
};

describe("bloch", () => {
  test.each([
    [[] as string[], { x: 0, y: 0, z: 1 }],
    [["x"], { x: 0, y: 0, z: -1 }],
    [["h"], { x: 1, y: 0, z: 0 }],
    [["h", "s"], { x: 0, y: 1, z: 0 }],
    [["h", "sdg"], { x: 0, y: -1, z: 0 }],
    [["h", "t"], { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }],
  ])("%j", (keys, want) => {
    const c = run(...keys);
    const v = bloch((c.engine as InlineEngine).core.reg.state, c.n, 0);
    expect(v.x).toBeCloseTo(want.x, 10);
    expect(v.y).toBeCloseTo(want.y, 10);
    expect(v.z).toBeCloseTo(want.z, 10);
  });

  test("entangled qubit is maximally mixed", () => {
    const c = run("h");
    cx(c, 0, 1);
    const v = bloch((c.engine as InlineEngine).core.reg.state, 2, 1);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(0, 10);
  });
});

describe("format", () => {
  test("complex", () => {
    expect(complex(Math.SQRT1_2, 0)).toBe("0.707");
    expect(complex(0, -Math.SQRT1_2)).toBe("−0.707i");
    expect(complex(0.5, -0.5)).toBe("0.5−0.5i");
    expect(complex(0, 1)).toBe("i");
    expect(complex(-1e-17, 0)).toBe("0");
  });
  test("pct hides float residue", () => {
    expect(pct(1e-32)).toBe("0%");
    expect(pct(1e-4)).toBe("<0.1%");
    expect(pct(0.5)).toBe("50.0%");
  });
  test("topK returns highest first", () => {
    const s = new Float64Array(16);
    [0.1, 0.4, 0.2, 0.3].forEach((p, i) => (s[2 * i + 2 * 4] = Math.sqrt(p)));
    const { idx, nonzero } = topK(s, 2);
    expect(nonzero).toBe(4);
    expect(idx).toEqual([5, 7]);
  });
});
