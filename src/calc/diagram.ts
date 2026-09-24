/**
 * Circuit-diagram layout for the Circuit tab's diagram: every step of the
 * tape placed in a column. A step goes in the column the editor pinned it to
 * (`Step.pin`), or as early as possible (ASAP) without one, and never before
 * what precedes it on its wires. A step occupies the wires from its lowest to
 * its highest qubit (the vertical line crosses the ones in between). The
 * classical bits are resources too: a step under IF c[k] goes after the last
 * measurement that wrote c[k], and a measurement into c[k] after the steps
 * that read it and the one that wrote it before. Order on each wire and each
 * bit is the tape order, so reading the columns left to right replays the
 * tape.
 *
 * `wires` lists the qubits drawn, top to bottom (all of them, or only the
 * ones the tape touches on a wide register); lo/hi are row indices.
 */
import { measuredBit, writesBit, type Entry, type Step } from "./steps";

/**
 * Step `k` of tape entry `entry`, drawn in column `col` across rows lo..hi;
 * it keeps its column free down to row `bottom` (a measurement's link or an
 * IF step's control line runs down to the classical bus under the wires).
 */
export type Placed = { entry: number; k: number; col: number; step: Step; lo: number; hi: number; bottom: number };

/** Does the step reach the classical bus (it writes or reads a bit)? */
export const reachesBus = (s: Step) => writesBit(s) || !!s.condition;
export type Layout = { cols: number; items: Placed[]; wires: number[] };

/** The qubits the tape touches (controls and targets), ascending. */
export function usedQubits(tape: Entry[]): number[] {
  const u = new Set<number>();
  for (const e of tape) for (const s of e) for (const q of [...s.controls, ...s.targets]) u.add(q);
  return [...u].sort((a, b) => a - b);
}

/** Order on the classical bits: each bit's last writer (column + 1) and last reader. */
export type BitOrder = { wrote: Map<number, number>; read: Map<number, number> };

/** The earliest column a step can take because of the bits it reads or writes. */
export function bitColumn(s: Step, b: BitOrder): number {
  let col = 0;
  if (s.condition) col = Math.max(col, b.wrote.get(s.condition.clbit) ?? 0);
  if (writesBit(s)) {
    const k = measuredBit(s);
    col = Math.max(col, b.wrote.get(k) ?? 0, b.read.get(k) ?? 0);
  }
  return col;
}

export function noteBits(s: Step, col: number, b: BitOrder) {
  if (s.condition) b.read.set(s.condition.clbit, Math.max(b.read.get(s.condition.clbit) ?? 0, col + 1));
  if (writesBit(s)) b.wrote.set(measuredBit(s), col + 1);
}

export function layoutTape(n: number, tape: Entry[], wires: number[] = Array.from({ length: n }, (_, q) => q)): Layout {
  const row = new Map(wires.map((q, i) => [q, i]));
  const free = new Array<number>(wires.length).fill(0); // next free column on each row
  const bits: BitOrder = { wrote: new Map(), read: new Map() };
  const items: Placed[] = [];
  let cols = 0;
  tape.forEach((entry, i) => {
    entry.forEach((step, k) => {
      const qs = [...step.controls, ...step.targets].map((q) => row.get(q)!);
      const lo = Math.min(...qs), hi = Math.max(...qs);
      const bottom = reachesBus(step) ? wires.length - 1 : hi;
      let col = step.pin !== undefined && step.pin > 0 ? step.pin : 0;
      for (let q = lo; q <= bottom; q++) col = Math.max(col, free[q]);
      col = Math.max(col, bitColumn(step, bits));
      for (let q = lo; q <= bottom; q++) free[q] = col + 1;
      noteBits(step, col, bits);
      items.push({ entry: i, k, col, step, lo, hi, bottom });
      cols = Math.max(cols, col + 1);
    });
  });
  return { cols, items, wires };
}
