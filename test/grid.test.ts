import { describe, test, expect } from "vitest";
import { compact, copyEntries, freeColumn, insertPinned, moveEntry, pasteClip, placeEntry, removeEntries, repositionEntry, shape } from "../src/calc/grid";
import { layoutTape } from "../src/calc/diagram";
import { calc, add } from "./ed";
import { formatEntry, type Entry, type Step } from "../src/calc/steps";
import { PALETTE } from "../src/calc/gateSpecs";

let id = 0;
const st = (gateId: string, targets: number[], controls: number[] = [], extra: Partial<Step> = {}): Step =>
  ({ id: `t${id++}`, gateId, column: 0, targets, controls, clbits: [], params: [], ...extra });
const names = (tape: Entry[]) => tape.map(formatEntry);
/** Each entry's drawn columns, "name@col". */
const drawn = (n: number, tape: Entry[]) => {
  const lay = layoutTape(n, tape);
  return tape.map((e, i) => `${formatEntry(e)}@${lay.items.filter((it) => it.entry === i).map((it) => it.col).join(",")}`);
};

describe("the grid (pure)", () => {
  // H q0, X q1, CX q0→q1, Z q2: drawn H@0 X@0 CX@1 Z@0
  const tape = (): Entry[] => [[st("h", [0])], [st("x", [1])], [st("x", [1], [0])], [st("z", [2])]];

  test("a pin is a column the layout keeps (never earlier than the wires allow)", () => {
    expect(drawn(3, [[st("h", [0], [], { pin: 3 })], [st("x", [0])]])).toEqual(["H q0@3", "X q0@4"]);
    expect(drawn(3, [[st("h", [0])], [st("x", [0], [], { pin: 0 })]])).toEqual(["H q0@0", "X q0@1"]);
    expect(drawn(3, compact([[st("h", [0], [], { pin: 3 })]]))).toEqual(["H q0@0"]);
  });

  test("a measurement waits for the steps that read its bit (write after read)", () => {
    const t: Entry[] = [[st("measure", [0])], [st("x", [2], [], { condition: { clbit: 0, value: 1 }, pin: 4 })], [st("measure", [0])]];
    expect(drawn(3, t)).toEqual(["M q0@0", "X q2 if c0=1@4", "M q0@5"].map((s) => s.replace("X q2 if c0=1", formatEntry(t[1]))));
  });

  test("a dropped gate lands in its column, or the first free one right of it (Quantiom's relocation)", () => {
    const t = tape();
    const r = placeEntry(3, t, [st("y", [0])], 3);
    expect(r.col).toBe(3);
    expect(drawn(3, r.tape)).toContain("Y q0@3");
    const onCx = placeEntry(3, t, [st("y", [1])], 1); // CX sits at column 1 on q0..q1
    expect(onCx.col).toBe(2);
    const onH = placeEntry(3, t, [st("y", [0])], 0); // H at 0, CX at 1: first free is 2
    expect(onH.col).toBe(2);
    expect(drawn(3, onH.tape)).toEqual(expect.arrayContaining(["H q0@0", "CX q0→q1@1", "Y q0@2"]));
  });

  test("a gate dropped before others on its wire goes before them in the tape (the circuit runs left to right)", () => {
    const t: Entry[] = [[st("h", [0], [], { pin: 2 })]];
    const r = placeEntry(2, t, [st("x", [0])], 0);
    expect(names(r.tape)).toEqual(["X q0", "H q0"]);
    expect(drawn(2, r.tape)).toEqual(["X q0@0", "H q0@2"]);
  });

  test("when the tape order can't hold a column, it is reordered without breaking any wire's order", () => {
    // X q1 is drawn at 5 but comes first in the tape; H q0 at 1. A 2-qubit gate dropped at 3 on q0,q1
    // must follow H and precede X: the tape becomes H, SWAP, X.
    const t: Entry[] = [[st("x", [1], [], { pin: 5 })], [st("h", [0], [], { pin: 1 })]];
    const r = placeEntry(2, t, [st("swap", [0, 1])], 3);
    expect(names(r.tape)).toEqual(["H q0", "SWAP q0,q1", "X q1"]);
    expect(drawn(2, r.tape)).toEqual(["H q0@1", "SWAP q0,q1@3", "X q1@5"]);
  });

  test("nothing slides when a gate is removed or moved", () => {
    const t = tape();
    expect(drawn(3, removeEntries(3, t, new Set([2])))).toEqual(["H q0@0", "X q1@0", "Z q2@0"]);
    const t2: Entry[] = [[st("h", [0])], [st("x", [0])], [st("z", [0])]];
    expect(drawn(1, removeEntries(1, t2, new Set([1])))).toEqual(["H q0@0", "Z q0@2"]);
    const m = moveEntry(1, t2, 0, 5, 0)!;
    expect(drawn(1, m.tape)).toEqual(["X q0@1", "Z q0@2", "H q0@5"]);
    expect(m.at).toBe(2);
  });

  test("a move keeps the grab offset (dq) and refuses to leave the register; dropping on itself changes nothing", () => {
    const t = tape();
    expect(moveEntry(3, t, 2, 1, 2)).toBeNull(); // CX q0→q1 two wires down: off a 3-qubit register
    const down = moveEntry(3, t, 2, 1, 1)!; // to q1→q2 at column 1
    expect(drawn(3, down.tape)).toEqual(expect.arrayContaining(["CX q1→q2@1"]));
    expect(drawn(3, moveEntry(3, t, 2, 1, 0)!.tape)).toEqual(drawn(3, t));
  });

  test("reassigning a dot keeps the column when free there", () => {
    const t = tape();
    const cx = t[2][0];
    const r = repositionEntry(3, t, 2, [{ ...cx, controls: [2] }]);
    expect(drawn(3, r.tape)).toEqual(expect.arrayContaining(["CX q2→q1@1"]));
  });

  test("an entry that needs several columns keeps its shape", () => {
    const ring: Entry = [st("rzz", [0, 1]), st("rzz", [1, 2]), st("rzz", [0, 2])];
    expect(shape(3, ring)).toEqual([0, 1, 2]);
    const lay = layoutTape(3, [[st("h", [1], [], { pin: 1 })]]);
    expect(freeColumn(lay.items, ring, shape(3, ring), 0)).toBe(2); // 0: its 2nd step would hit H at 1
    const r = insertPinned([], layoutTape(3, []), ring.map((s, k) => ({ ...s, pin: 4 + k })));
    expect(drawn(3, r.tape)[0]).toMatch(/@4,5,6$/);
  });

  test("copy and paste: the columns relative to each other, after the circuit", () => {
    const t = tape();
    const clip = copyEntries(3, t, new Set([0, 2])); // H@0, CX@1
    let k = 0;
    const p = pasteClip(3, t, clip, () => `p${k++}`);
    expect(p.added).toBe(2);
    expect(drawn(3, p.tape).slice(-2)).toEqual(["H q0@2", "CX q0→q1@3"]);
    expect(pasteClip(1, [], clip, () => "x").added).toBe(1); // the CX needs q1: skipped
  });

});

describe("editing in the calculator", () => {
  test("drop tiles in cells, move, re-angle, control, delete; UNDO takes back each", () => {
    const c = calc();
    c.setQubitCount(3);
    const tile = (id: string) => PALETTE.find((p) => p.id === id)!;
    c.placeItem(tile("h"), 2, 0);
    c.placeItem(tile("x"), 0, 0);
    expect(names(c.tape)).toEqual(["X q0", "H q2"]); // both in column 0: on other wires, either order runs the same
    c.placeItem(tile("ry"), 2, 0); // H is at column 0 on q2: RY goes to column 1
    expect(drawn(3, c.tape)).toEqual(["X q0@0", "H q2@0", "RY(π÷2) q2@1"]);
    c.selectStep(2);
    c.setGateParams(2, ["π/4"]);
    expect(c.diagSel).toBe(2);
    c.nudgeSelected(0, -1); // up to q1, same column (the tape may reorder: the selection follows the gate)
    c.addControl(c.diagSel!, 0);
    expect(drawn(3, c.tape)).toContain("CRY(π÷4) q0→q1@1");
    c.moveGate(c.diagSel!, 4, 0);
    expect(drawn(3, c.tape)).toContain("CRY(π÷4) q0→q1@4");
    c.nudgeSelected(-1, 0); // left to the nearest free column: 3
    expect(drawn(3, c.tape)).toContain("CRY(π÷4) q0→q1@3");
    c.removeGate(c.diagSel!);
    expect(names(c.tape).sort()).toEqual(["H q2", "X q0"]);
    c.undo();
    c.undo();
    expect(drawn(3, c.tape)).toContain("CRY(π÷4) q0→q1@4");
  });

  test("a tapped cell takes tapped tiles, left to right", () => {
    const c = calc();
    c.setQubitCount(2);
    const tile = (id: string) => PALETTE.find((p) => p.id === id)!;
    c.tapCell({ row: 1, col: 2 });
    c.placeItem(tile("h"), c.cursor!.row);
    c.placeItem(tile("x"), c.cursor!.row);
    expect(drawn(2, c.tape)).toEqual(["H q1@2", "X q1@3"]);
    expect(c.cursor).toEqual({ row: 1, col: 4 });
    c.tapCell(null);
    c.placeItem(tile("z"), 0); // no cell: after the last gate on q0 (none): column 0
    expect(drawn(2, c.tape)).toContain("Z q0@0");
  });

  test("new qubits of the wrong count are refused; deselecting keeps the circuit", () => {
    const c = calc();
    add(c, "h", [0]);
    c.selectStep(0);
    expect(c.setGateQubits(0, [0, 1])).toBe(false);
    expect(c.message).toEqual({ kind: "error", text: "H acts on 1 qubit" });
    expect(names(c.tape)).toEqual(["H q0"]);
    c.selectStep(null);
    expect(c.diagSel).toBeNull();
    expect(names(c.tape)).toEqual(["H q0"]);
  });

  test("new angles keep the gate selected; duplicate goes in the next free column", () => {
    const c = calc();
    add(c, "rx", [0], { params: ["π/2"] });
    add(c, "h", [0]);
    c.selectStep(0);
    expect(c.setGateParams(0, ["2"])).toBe(true);
    expect(names(c.tape)).toEqual(["RX(2) q0", "H q0"]);
    expect(c.diagSel).toBe(0);
    expect(c.setGateParams(0, ["2", "3"])).toBe(false); // RX has one angle
    expect(c.message?.kind).toBe("error");
    c.duplicateGate(0); // column 1 holds H: the copy goes to 2
    expect(drawn(1, c.tape)).toEqual(["RX(2) q0@0", "H q0@1", "RX(2) q0@2"]);
  });

  test("a control goes on any wire that isn't on the gate; a measurement takes none; add anywhere picks a free wire", () => {
    const c = calc();
    c.setQubitCount(3);
    add(c, "h", [0]);
    expect(c.addControl(0, 0)).toBe(false);
    expect(c.message).toEqual({ kind: "error", text: "q0 is already on this gate" });
    expect(c.addControlAnywhere(0)).toBe(true);
    expect(names(c.tape)).toEqual(["CH q1→q0"]);
    c.removeControl(0, 1);
    expect(names(c.tape)).toEqual(["H q0"]);
    add(c, "measure", [0]);
    expect(c.addControl(1, 1)).toBe(false);
  });

  test("select a rectangle, copy, paste after the circuit, cut, delete", () => {
    const c = calc();
    c.setQubitCount(2);
    add(c, "h", [0]);
    add(c, "x", [1], { controls: [0] });
    add(c, "z", [1]);
    c.selectBox(0, 1, 0, 1); // H@0, CX@1
    expect([...c.diagSet].sort()).toEqual([0, 1]);
    c.copySelection();
    c.paste();
    expect(drawn(2, c.tape).slice(-2)).toEqual(["H q0@3", "CX q0→q1@4"]);
    c.selectBox(3, 4, 0, 1);
    c.cutSelection();
    expect(names(c.tape)).toEqual(["H q0", "CX q0→q1", "Z q1"]);
    c.selectAll();
    c.deleteSelection();
    expect(c.tape).toHaveLength(0);
    c.undo();
    expect(c.tape).toHaveLength(3);
  });

  test("compact pulls every gate left; UNDO and REDO let go of the selection", () => {
    const c = calc();
    add(c, "h", [0]);
    c.moveGate(0, 5, 0);
    expect(drawn(1, c.tape)).toEqual(["H q0@5"]);
    c.compactColumns();
    expect(drawn(1, c.tape)).toEqual(["H q0@0"]);
    c.selectStep(0);
    c.undo();
    expect(c.diagSel).toBeNull();
  });
});
