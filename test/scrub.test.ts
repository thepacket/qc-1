import { describe, test, expect } from "vitest";
import { Calculator, type KeyId } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";

const calc = () => new Calculator(new InlineEngine());
const keys = (c: Calculator, ...ks: KeyId[]) => ks.forEach((k) => c.press(k));
const ket = (c: Calculator) => {
  const v = c.view!;
  if (v.mode !== "ket") throw new Error(v.mode);
  return v.rows.filter((r) => r.re ** 2 + r.im ** 2 > 1e-12).map((r) => r.i);
};

describe("TAPE step-scrubber", () => {
  test("views show the state after k entries; the register is untouched", () => {
    const c = calc();
    keys(c, "h", "ctrl", "right", "x", "z"); // H, CX, Z → (|00⟩ − |11⟩)/√2… with Z on q0
    expect(ket(c)).toEqual([0, 3]);
    c.setScrub(0);
    expect(ket(c)).toEqual([0]);
    expect(c.view!.at).toBe(0);
    c.setScrub(1);
    expect(ket(c)).toEqual([0, 2]);
    c.setScrub(99); // past the end = live
    expect(c.scrub).toBeNull();
    expect(c.view!.at).toBeUndefined();
    expect(ket(c)).toEqual([0, 3]);
    expect(c.tape).toHaveLength(3);
  });

  test("a measurement replays its recorded outcome", () => {
    const c = calc();
    keys(c, "h", "meas", "x");
    const outcome = c.tape[1][0].outcome!;
    for (let k = 0; k < 5; k++) {
      c.setScrub(2);
      expect(ket(c)).toEqual([outcome << 1]);
      c.setScrub(null);
    }
  });

  test("keying a gate ends the scrub", () => {
    const c = calc();
    keys(c, "h", "x");
    c.setScrub(1);
    keys(c, "z");
    expect(c.scrub).toBeNull();
    expect(c.view!.at).toBeUndefined();
    expect(c.tape).toHaveLength(3);
  });

  test("scrubbing works past the snapshot interval", () => {
    const c = calc();
    for (let i = 0; i < 9; i++) keys(c, "x");
    for (let k = 0; k <= 9; k++) {
      c.setScrub(k);
      expect(ket(c)).toEqual([k % 2 ? 2 : 0]);
    }
  });
});
