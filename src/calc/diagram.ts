/**
 * Circuit-diagram layout for TAPE's CIRC pane: every step of the tape placed
 * in a column, as early as possible (ASAP). A step occupies the wires from
 * its lowest to its highest qubit (the vertical line crosses the ones in
 * between), and a step under IF also waits for the measurement that wrote
 * its bit (c[k] is written by measuring q_k). Order on each wire is the tape
 * order, so reading the columns left to right replays the tape.
 *
 * `wires` lists the qubits drawn, top to bottom (all of them, or only the
 * ones the tape touches on a wide register); lo/hi are row indices.
 */
import type { Entry, Step } from "./steps";

export type Placed = { entry: number; col: number; step: Step; lo: number; hi: number };
export type Layout = { cols: number; items: Placed[]; wires: number[] };

/** The qubits the tape touches (controls, targets, IF bits), ascending. */
export function usedQubits(tape: Entry[]): number[] {
  const u = new Set<number>();
  for (const e of tape) for (const s of e) {
    for (const q of [...s.controls, ...s.targets]) u.add(q);
    if (s.condition) u.add(s.condition.clbit);
  }
  return [...u].sort((a, b) => a - b);
}

export function layoutTape(n: number, tape: Entry[], wires: number[] = Array.from({ length: n }, (_, q) => q)): Layout {
  const row = new Map(wires.map((q, i) => [q, i]));
  const free = new Array<number>(wires.length).fill(0); // next free column on each row
  const items: Placed[] = [];
  let cols = 0;
  tape.forEach((entry, i) => {
    for (const step of entry) {
      const qs = [...step.controls, ...step.targets].map((q) => row.get(q)!);
      const lo = Math.min(...qs), hi = Math.max(...qs);
      let col = 0;
      for (let q = lo; q <= hi; q++) col = Math.max(col, free[q]);
      const c = step.condition && row.get(step.condition.clbit);
      if (c !== undefined) col = Math.max(col, free[c]);
      for (let q = lo; q <= hi; q++) free[q] = col + 1;
      items.push({ entry: i, col, step, lo, hi });
      cols = Math.max(cols, col + 1);
    }
  });
  return { cols, items, wires };
}
