import { layoutTape } from "../calc/diagram";
import { freeColumn, moveEntries, shape, shiftEntry } from "../calc/grid";
import { itemWidth, spanFrom } from "../calc/gateSpecs";
import { NONUNITARY, type Entry } from "../calc/steps";
import type { DragPayload, Spot } from "./dnd";

/** The preview and drop guard share the same validity rules. */
export function placementHint(n: number, tape: Entry[], p: DragPayload, spot: Spot, selected = new Set<number>()): { error?: string; text: string } {
  const bad = (error: string) => ({ error, text: error });
  if (p.kind === "bit") return spot.row < n ? bad("Drop this connection on a classical bit lane.") : { text: `${p.role === "write" ? "Write" : "Read"} c${spot.row - n}` };
  if (spot.row >= n) return bad("Gates belong on quantum wires; choose a q wire.");
  const lay = layoutTape(n, tape);
  let entry: Entry, skip = -1;
  if (p.kind === "new") {
    const k = Math.max(1, itemWidth(p.item));
    if (k > n) return bad(`${p.item.label} needs ${k} qubits; this circuit has ${n}.`);
    if (p.item.kind !== "gate" && p.item.kind !== "custom") return { text: `Configure ${p.item.label} starting at q${spot.row}, column ${spot.col + 1}.` };
    const qs = spanFrom(spot.row, k, n), controls = p.item.kind === "gate" ? p.item.controls : 0;
    entry = [{ id: "preview", gateId: p.item.gate, column: 0, controls: qs.slice(0, controls), targets: qs.slice(controls), clbits: [], params: [] }];
  } else {
    const source = tape[p.entry];
    if (!source) return bad("This gate is no longer available.");
    const step = source[0];
    if (p.kind === "addctl" || p.kind === "dot") {
      const own = p.kind === "dot" ? (p.role === "target" ? step.targets : step.controls)[p.index] : undefined;
      if (own === spot.row) return placementHint(n, tape, { kind: "move", entry: p.entry, grabRow: spot.row }, spot);
      if (own !== spot.row && source.some(s => [...s.targets, ...s.controls].includes(spot.row))) return bad(`q${spot.row} is already used by this gate.`);
      if (p.kind === "addctl" && NONUNITARY.has(step.gateId)) return bad("Measurement, reset and preparation cannot have quantum controls.");
      if (p.kind === "dot" && source.length > 1) return bad("Edit broadcast gates individually before moving a connection.");
      return { text: `${p.kind === "addctl" ? "Add control" : `Move ${p.role}`} to q${spot.row}` };
    }
    if (selected.has(p.entry) && selected.size > 1) {
      const anchor = Math.min(...lay.items.filter(it => it.entry === p.entry).map(it => it.col));
      const left = Math.min(...lay.items.filter(it => selected.has(it.entry)).map(it => it.col));
      const r = moveEntries(n, tape, selected, spot.col - anchor + left, spot.row - p.grabRow);
      return r ? { text: `Move ${selected.size} gates to column ${r.col + 1}; shift wires by ${spot.row - p.grabRow}.` } : bad("Selection cannot fit here without changing its shape. Choose another column or wire.");
    }
    const shifted = shiftEntry(source, spot.row - p.grabRow, n);
    if (!shifted) return bad("The gate would extend beyond the available qubits.");
    entry = shifted; skip = p.entry;
  }
  const col = freeColumn(lay.items, entry, shape(n, entry), spot.col, skip, n);
  const qs = [...new Set(entry.flatMap(s => [...s.controls, ...s.targets]))];
  return { text: `Place on ${qs.map(q => `q${q}`).join(", ")}, column ${col + 1}${col !== spot.col ? " (next free column)" : ""}.` };
}
