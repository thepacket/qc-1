/**
 * Circuit edits made in the diagram (CIRC → DIAG): pure functions from a tape
 * to a new tape, which the calculator applies as one undoable replace. An
 * edit acts on a whole entry (one key press; an ALL entry moves as a unit).
 *
 * "Earlier" and "later" are what the diagram shows: an entry moves past the
 * nearest entry it shares a wire with (its span, lowest to highest qubit,
 * as drawn), so every move is visible; entries on other wires commute with it
 * and keep their places.
 */
import type { Entry, Step } from "./steps";
import type { Placed } from "./diagram";

const qubitsOf = (e: Entry) => e.flatMap((s) => [...s.controls, ...s.targets]);
const spanOf = (e: Entry): [number, number] => { const q = qubitsOf(e); return [Math.min(...q), Math.max(...q)]; };
const overlap = (a: Entry, b: Entry) => { const [al, ah] = spanOf(a), [bl, bh] = spanOf(b); return al <= bh && bl <= ah; };

/** Move entry `from` to sit before tape index `to` (indices of the original tape). Returns the tape and the entry's new index. */
export function reorder(tape: Entry[], from: number, to: number): { tape: Entry[]; at: number } {
  const e = tape[from];
  const rest = tape.filter((_, i) => i !== from);
  const at = to > from ? to - 1 : to;
  return { tape: [...rest.slice(0, at), e, ...rest.slice(at)], at };
}

/** One visible step earlier: before the nearest earlier entry sharing a wire. Null when nothing is in the way. */
export function moveEarlier(tape: Entry[], i: number): { tape: Entry[]; at: number } | null {
  for (let j = i - 1; j >= 0; j--) if (overlap(tape[i], tape[j])) return reorder(tape, i, j);
  return null;
}

/** One visible step later: after the nearest later entry sharing a wire. */
export function moveLater(tape: Entry[], i: number): { tape: Entry[]; at: number } | null {
  for (let j = i + 1; j < tape.length; j++) if (overlap(tape[i], tape[j])) return reorder(tape, i, j + 1);
  return null;
}

/** Every qubit of the entry moved by dq (a gate to another wire), or null off the register. */
export function shiftEntry(e: Entry, dq: number, n: number): Entry | null {
  const q = qubitsOf(e);
  if (Math.min(...q) + dq < 0 || Math.max(...q) + dq >= n) return null;
  return e.map((s) => ({
    ...s, targets: s.targets.map((t) => t + dq), controls: s.controls.map((c) => c + dq),
    ...(s.condition ? { condition: { ...s.condition } } : {}),
  }));
}

/** Add qubit q as a control of every step, or remove it if it is one. Null when q is a target or the gate can't be controlled. */
export function toggleControl(e: Entry, q: number, uncontrollable: (gateId: string) => boolean): Entry | null {
  if (e.some((s) => s.targets.includes(q) || uncontrollable(s.gateId))) return null;
  return e.map((s): Step => {
    const states = s.controlStates ?? s.controls.map(() => true);
    const k = s.controls.indexOf(q);
    if (k >= 0) {
      const controls = s.controls.filter((_, i) => i !== k), cs = states.filter((_, i) => i !== k);
      return { ...s, controls, controlStates: cs.some((on) => !on) ? cs : undefined };
    }
    return { ...s, controls: [...s.controls, q], controlStates: s.controlStates ? [...s.controlStates, true] : undefined };
  });
}

/**
 * Where a gate placed at diagram column `col` on wire rows lo..hi goes in the
 * tape: just before the first entry on those wires at or right of `col`, else
 * just after the last one on them. Entries on other wires don't matter (they
 * commute with it). Rows are the diagram's (qubits, unless a wide register
 * draws only the used wires).
 */
export function insertionIndex(items: Placed[], col: number, lo = -Infinity, hi = Infinity): number {
  const on = items.filter((it) => it.lo <= hi && lo <= it.hi);
  const right = on.filter((it) => it.col >= col);
  if (right.length) return Math.min(...right.map((it) => it.entry));
  return on.length ? Math.max(...on.map((it) => it.entry)) + 1 : 0;
}

/** Move entry i to diagram column `col` (drag and drop), shifted by dq wires. */
export function dropEntry(tape: Entry[], items: Placed[], i: number, col: number, dq: number, n: number): { tape: Entry[]; at: number } | null {
  const moved = dq ? shiftEntry(tape[i], dq, n) : tape[i];
  if (!moved) return null;
  const mine = items.filter((it) => it.entry === i);
  const lo = Math.min(...mine.map((it) => it.lo)) + dq, hi = Math.max(...mine.map((it) => it.hi)) + dq;
  const withMoved = tape.map((e, k) => (k === i ? moved : e));
  // The insertion point is computed without the entry itself, so dropping it back where it was changes nothing;
  // with nothing else on its new wires, its place in the tape doesn't matter.
  const others = items.filter((it) => it.entry !== i);
  if (!others.some((it) => it.lo <= hi && lo <= it.hi)) return { tape: withMoved, at: i };
  return reorder(withMoved, i, insertionIndex(others, col, lo, hi));
}
