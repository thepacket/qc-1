import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calc, add, stateOf } from "./ed";
import { layoutTape } from "../src/calc/diagram";
import { moveEntries } from "../src/calc/grid";
import { PALETTE } from "../src/calc/gateSpecs";
import { placementHint } from "../src/ui/circuitPlacement";
import { CircuitView } from "../src/ui/CircuitView";

const html = (c: ReturnType<typeof calc>) => renderToStaticMarkup(createElement(CircuitView, { calc: c }));

test("direct gate editor maps parameters and target edits to the simulated state and supports undo", () => {
  const c = calc(); add(c, "ry", [0], { params: ["pi/2"] }); c.selectStep(0);
  expect(html(c)).toContain('aria-label="Selected gate editor"');
  expect(html(c)).toContain('aria-label="target 1"');
  expect(c.setGateParams(0, ["pi"])).toBe(true);
  expect(c.reassignQubit(0, "target", 0, 1)).toBe(true);
  expect(stateOf(c)[4]).toBeCloseTo(1); // |10>, q1
  c.undo(); expect(stateOf(c)[2]).toBeCloseTo(1); // |01>, q0
});

test("group movement preserves spacing, state, selection and one-step undo", () => {
  const c = calc(); add(c, "h", [0]); add(c, "x", [1], { controls: [0] });
  const before = [...stateOf(c)], ids = c.tape.map(e => e[0].id);
  c.toggleStep(0); c.toggleStep(1);
  expect(c.moveSelection(4, 0)).toBe(true);
  expect(layoutTape(c.n, c.tape).items.map(it => it.col)).toEqual([4, 5]);
  expect([...c.diagSet]).toEqual([0, 1]); expect([...stateOf(c)]).toEqual(before);
  expect(c.moveSelection(4, 1)).toBe(false); // pair cannot extend past q1
  expect(c.tape.map(e => e[0].id)).toEqual(ids);
  c.undo(); expect(layoutTape(c.n, c.tape).items.map(it => it.col)).toEqual([0, 1]);
});

test("group copy/paste has fresh IDs, stays selected, and can become an inspectable block", () => {
  const c = calc(); add(c, "h", [0]); add(c, "x", [1], { controls: [0] });
  c.selectAll(); c.copySelection(); c.paste();
  expect([...c.diagSet]).toEqual([2, 3]);
  expect(new Set(c.tape.flat().map(s => s.id)).size).toBe(4);
  expect(c.saveSelectionAsGate()).toBeTruthy();
  c.selectStep(c.tape.length - 1);
  const tape = JSON.stringify(c.tape), state = [...stateOf(c)];
  expect(html(c)).toContain("Inspect G1"); expect(html(c)).toContain("local q1 → q1");
  expect(JSON.stringify(c.tape)).toBe(tape); expect([...stateOf(c)]).toEqual(state);
});

test("placement warns about occupied qubits, too-small registers, classical lanes and shifted columns", () => {
  const c = calc(); add(c, "h", [0]);
  const h = PALETTE.find(p => p.kind === "gate" && p.gate === "h")!;
  const hint = placementHint(2, c.tape, { kind: "new", item: h }, { row: 0, col: 0 });
  expect(hint.text).toContain("column 2 (next free column)");
  c.placeItem(h, 0, 0); expect(layoutTape(2, c.tape).items.at(-1)!.col).toBe(1);
  expect(placementHint(2, c.tape, { kind: "new", item: h }, { row: 2, col: 0 }).error).toContain("quantum wires");
  expect(placementHint(2, c.tape, { kind: "addctl", entry: 0 }, { row: 0, col: 0 }).error).toContain("already used");
  const cx = PALETTE.find(p => p.kind === "gate" && p.gate === "x" && p.controls === 1)!;
  expect(placementHint(1, [], { kind: "new", item: cx }, { row: 0, col: 0 }).error).toContain("needs 2");
});

test("classical condition selection highlights its bit and preserves measurement destinations in group moves", () => {
  const c = calc();
  c.loadQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; bit[2] c; h q[0]; c[1] = measure q[0]; if(c[1] == 1) x q[1];', "classical test");
  c.selectStep(2);
  const output = html(c);
  expect(output).toContain("clabel active-bit"); expect(output).toContain("cread active-bit");
  c.selectAll(); const moved = moveEntries(2, c.tape, c.diagSet, 5, 0)!;
  expect(moved).not.toBeNull();
  expect(moved.tape[1][0].clbits).toEqual([1]); expect(moved.tape[2][0].condition?.clbit).toBe(1);
  expect(layoutTape(2, moved.tape).items.map(it => it.col)).toEqual([5, 6, 7]);
});
