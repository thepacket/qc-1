/**
 * Circuit-diagram layout for the Circuit tab's diagram: every step of the
 * tape placed in a column. A step goes in the column the editor pinned it to
 * (`Step.pin`), or as early as possible (ASAP) without one, and never before
 * what precedes it on its wires. A step occupies the wires from its lowest to
 * its highest qubit (the vertical line crosses the ones in between); a step
 * under IF also waits for what came before on the wire of its bit (c[k] is
 * written by measuring q_k), and a later measurement of q_k waits for the
 * steps that read c[k]. Order on each wire is the tape order, so reading the
 * columns left to right replays the tape.
 *
 * `wires` lists the qubits drawn, top to bottom (all of them, or only the
 * ones the tape touches on a wide register); lo/hi are row indices.
 */
import { NONUNITARY, type Entry, type Step } from "./steps";

/** Step `k` of tape entry `entry`, drawn in column `col` across rows lo..hi. */
export type Placed = { entry: number; k: number; col: number; step: Step; lo: number; hi: number };
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

/** Does the step write classical bits (c[q] for its targets)? */
export const writesBits = (s: Step) => NONUNITARY.has(s.gateId);

export function layoutTape(n: number, tape: Entry[], wires: number[] = Array.from({ length: n }, (_, q) => q)): Layout {
  const row = new Map(wires.map((q, i) => [q, i]));
  const free = new Array<number>(wires.length).fill(0); // next free column on each row
  const read = new Array<number>(wires.length).fill(0); // a writer of c[row] goes after the steps reading it
  const items: Placed[] = [];
  let cols = 0;
  tape.forEach((entry, i) => {
    entry.forEach((step, k) => {
      const qs = [...step.controls, ...step.targets].map((q) => row.get(q)!);
      const lo = Math.min(...qs), hi = Math.max(...qs);
      let col = step.pin !== undefined && step.pin > 0 ? step.pin : 0;
      for (let q = lo; q <= hi; q++) col = Math.max(col, free[q]);
      const c = step.condition && row.get(step.condition.clbit);
      if (c !== undefined) col = Math.max(col, free[c]);
      if (writesBits(step)) for (const t of step.targets) col = Math.max(col, read[row.get(t)!]);
      for (let q = lo; q <= hi; q++) free[q] = col + 1;
      if (c !== undefined) read[c] = Math.max(read[c], col + 1);
      items.push({ entry: i, k, col, step, lo, hi });
      cols = Math.max(cols, col + 1);
    });
  });
  return { cols, items, wires };
}
