import { describe, test, expect } from "vitest";
import { Calculator } from "../src/calc/calculator";
import { Core } from "../src/calc/core";
import { Register } from "../src/calc/register";
import { formatEntry } from "../src/calc/steps";
import { randomTape, rng } from "../validation/cases/tapes";

import { calc, add, cx } from "./ed";

/** 1-qubit gates on q0, in order. */
const q0 = (c: Calculator, ...gates: string[]) => gates.forEach((g) => add(c, g, [0]));
const ket = (c: Calculator) => {
  const v = c.view!;
  if (v.mode !== "ket") throw new Error(v.mode);
  return v.rows.filter((r) => r.re ** 2 + r.im ** 2 > 1e-12).map((r) => r.i);
};

describe("TAPE step-scrubber", () => {
  test("views show the state after k entries; the register is untouched", () => {
    const c = calc();
    add(c, "h", [0]);
    cx(c, 0, 1);
    add(c, "z", [0]); // H, CX, Z → (|00⟩ − |11⟩)/√2… with Z on q0
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
    q0(c, "h", "measure", "x");
    const outcome = c.tape[1][0].outcome!;
    for (let k = 0; k < 5; k++) {
      c.setScrub(2);
      expect(ket(c)).toEqual([outcome << 1]);
      c.setScrub(null);
    }
  });

  test("while scrubbed, a gate goes in at the scrub point and the scrub follows it; a grid edit ends the scrub", () => {
    const c = calc();
    q0(c, "h", "x");
    c.setScrub(1);
    q0(c, "z");
    expect(c.scrub).toBe(2);
    expect(c.view!.at).toBe(2);
    expect(c.tape.map(formatEntry)).toEqual(["H q0", "Z q0", "X q0"]);
    c.duplicateGate(1); // a copy in the next free column after the Z (the X holds column 2): an edit on the grid ends the scrub
    expect(c.tape.map(formatEntry)).toEqual(["H q0", "Z q0", "X q0", "Z q0"]);
    expect(c.scrub).toBeNull();
    c.undo(); // one edit, one undo
    expect(c.tape.map(formatEntry)).toEqual(["H q0", "Z q0", "X q0"]);
  });

  test("DEL removes the entry before the scrub point (the last one when live); UNDO restores it", () => {
    const c = calc();
    q0(c, "h", "x", "z");
    c.setScrub(2);
    c.deleteStep();
    expect(c.tape.map(formatEntry)).toEqual(["H q0", "Z q0"]);
    expect(c.scrub).toBe(1);
    expect(ket(c)).toEqual([0, 2]);
    c.setScrub(null);
    c.deleteStep();
    expect(c.tape.map(formatEntry)).toEqual(["H q0"]);
    expect(c.scrub).toBeNull();
    c.undo();
    c.undo();
    expect(c.tape.map(formatEntry)).toEqual(["H q0", "X q0", "Z q0"]);
  });

  test("an edited tape equals the same tape built from scratch (random tapes, exact)", () => {
    const r = rng(7);
    for (let trial = 0; trial < 25; trial++) {
      const n = 1 + r.int(4);
      const tape = randomTape(r, n, 8);
      const extra = randomTape(r, n, 1)[0];
      const at = r.int(tape.length + 1);
      const core = new Core();
      core.handle({ t: "load", n, tape });
      core.handle({ t: "insert", at, entry: extra });
      const want = [...tape.slice(0, at), extra, ...tape.slice(at)];
      expect([...(core.reg as Register).state]).toEqual([...new Register(n, want).state]);
      const del = r.int(want.length);
      core.handle({ t: "delete", at: del });
      expect([...(core.reg as Register).state]).toEqual([...new Register(n, want.filter((_, i) => i !== del)).state]);
    }
  });

  test("later measurements keep their recorded outcomes unless they become impossible", () => {
    const c = calc();
    q0(c, "measure"); // |0⟩ → 0
    c.setScrub(0);
    q0(c, "x"); // X before the measurement: 0 is now impossible
    expect(c.tape[1][0].outcome).toBe(1);
  });

  test("stabilizer mode: a refused insert leaves the register as it was", () => {
    const c = calc();
    c.loadQasm(`OPENQASM 3.0; include "stdgates.inc"; qubit[30] q; h q[0]; cx q[0], q[29];`, "import");
    c.setScrub(1);
    q0(c, "t");
    expect(c.message?.kind).toBe("error");
    expect(c.tape.map(formatEntry)).toEqual(["H q0", "CX q0→q29"]);
    c.setScrub(1);
    q0(c, "s");
    expect(c.tape.map(formatEntry)).toEqual(["H q0", "S q0", "CX q0→q29"]);
  });

  test("scrubbing works past the snapshot interval", () => {
    const c = calc();
    for (let i = 0; i < 9; i++) q0(c, "x");
    for (let k = 0; k <= 9; k++) {
      c.setScrub(k);
      expect(ket(c)).toEqual([k % 2 ? 2 : 0]);
    }
  });
});
