import { describe, test, expect } from "vitest";
import { dropEntry, insertionIndex, moveEarlier, moveLater, reorder, shiftEntry, toggleControl } from "../src/calc/diagEdit";
import { layoutTape } from "../src/calc/diagram";
import { Calculator, type KeyId } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { formatEntry, NONUNITARY, type Entry, type Step } from "../src/calc/steps";

let id = 0;
const st = (gateId: string, targets: number[], controls: number[] = [], params: string[] = []): Step => ({ id: `t${id++}`, gateId, column: 0, targets, controls, clbits: [], params });
const names = (tape: Entry[]) => tape.map(formatEntry);

describe("diagram edits (pure)", () => {
  // H q0, X q1, CX q0→q1, Z q2
  const tape = (): Entry[] => [[st("h", [0])], [st("x", [1])], [st("x", [1], [0])], [st("z", [2])]];

  test("reorder moves an entry before an index", () => {
    expect(names(reorder(tape(), 3, 0).tape)).toEqual(["Z q2", "H q0", "X q1", "CX q0→q1"]);
    expect(names(reorder(tape(), 0, 4).tape)).toEqual(["X q1", "CX q0→q1", "Z q2", "H q0"]);
  });

  test("earlier/later move past the nearest gate sharing a wire (a visible move), not past gates elsewhere", () => {
    expect(names(moveEarlier(tape(), 2)!.tape)).toEqual(["H q0", "CX q0→q1", "X q1", "Z q2"]);
    expect(moveEarlier(tape(), 3)).toBeNull(); // Z q2 shares no wire with anything before it
    expect(names(moveLater(tape(), 0)!.tape)).toEqual(["X q1", "CX q0→q1", "H q0", "Z q2"]);
    expect(moveLater(tape(), 2)).toBeNull();
  });

  test("shift moves every qubit of the entry, and refuses to leave the register", () => {
    expect(names([shiftEntry(tape()[2], 1, 3)!])).toEqual(["CX q1→q2"]);
    expect(shiftEntry(tape()[2], 2, 3)).toBeNull();
    expect(shiftEntry(tape()[0], -1, 3)).toBeNull();
  });

  test("controls toggle on and off; a target or a measurement can't take one", () => {
    const e = toggleControl(tape()[1], 2, (g) => NONUNITARY.has(g))!;
    expect(names([e])).toEqual(["CX q2→q1"]);
    expect(names([toggleControl(e, 2, (g) => NONUNITARY.has(g))!])).toEqual(["X q1"]);
    expect(toggleControl(tape()[1], 1, (g) => NONUNITARY.has(g))).toBeNull();
    expect(toggleControl([st("measure", [0])], 1, (g) => NONUNITARY.has(g))).toBeNull();
  });

  test("placing follows the tapped wire: before its first gate at or right of the column, else after its last; dropping a gate where it was changes nothing", () => {
    const t = tape();
    const items = layoutTape(3, t).items; // cols: H q0, X q1, Z q2 at 0; CX q0→q1 at 1
    expect(insertionIndex(items, 0, 0, 0)).toBe(0); // q0, before H
    expect(insertionIndex(items, 1, 0, 0)).toBe(2); // q0, between H and the CX (not after the Z on q2)
    expect(insertionIndex(items, 2, 0, 0)).toBe(3); // q0, after the CX
    expect(insertionIndex(items, 1, 2, 2)).toBe(4); // q2, after the Z
    const cxCol = items.find((it) => it.entry === 2)!.col;
    expect(names(dropEntry(t, items, 2, cxCol, 0, 3)!.tape)).toEqual(names(t));
    expect(names(dropEntry(t, items, 3, 0, -2, 3)!.tape)).toEqual(["Z q0", "H q0", "X q1", "CX q0→q1"]);
  });
});

describe("editing in the calculator", () => {
  const calc = () => new Calculator(new InlineEngine());
  const keys = (c: Calculator, ...ks: KeyId[]) => ks.forEach((k) => c.press(k));

  test("tap a wire to place, key gates there; select, change, move, re-angle, control, delete; UNDO takes back each", () => {
    const c = calc();
    keys(c, "3", "2nd", "q"); // n = 3
    // Build from scratch in the diagram: tap wire q2 at the start, key H; tap q0 at the start, key X.
    c.tapWire(2, 0); keys(c, "h");
    c.tapWire(0, 0); keys(c, "x");
    expect(names(c.tape)).toEqual(["X q0", "H q2"]);
    // Select the H and change it to RY(π/4) with the typed angle.
    c.selectStep(1);
    keys(c, "pi", "div", "4", "ry");
    expect(names(c.tape)).toEqual(["X q0", "RY(π÷4) q2"]);
    // A new angle, then up a wire, then a control from q0, then earlier (past the X on q0).
    keys(c, "pi", "div", "2"); c.setSelectedParams();
    c.shiftSelected(-1);
    c.toggleCtrlPick(); c.tapWire(0, 0);
    expect(names(c.tape)).toEqual(["X q0", "CRY(π÷2) q0→q1"]);
    c.moveSelected(-1);
    expect(names(c.tape)).toEqual(["CRY(π÷2) q0→q1", "X q0"]);
    expect(c.diagSel).toBe(0);
    c.deleteSelected();
    expect(names(c.tape)).toEqual(["X q0"]);
    keys(c, "undo", "undo");
    expect(names(c.tape)).toEqual(["X q0", "CRY(π÷2) q0→q1"]);
  });

  test("a gate key of the wrong size is refused; AC lets go of the selection", () => {
    const c = calc();
    keys(c, "h");
    c.selectStep(0);
    keys(c, "swap");
    expect(c.message?.kind).toBe("error");
    expect(names(c.tape)).toEqual(["H q0"]);
    keys(c, "ac");
    expect(c.diagSel).toBeNull();
    expect(names(c.tape)).toEqual(["H q0"]);
  });
});
