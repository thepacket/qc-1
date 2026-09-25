/**
 * Circuit editing on the diagram's grid, after Quantiom's editor: a gate goes
 * in the column it is dropped in (the first free one to its right when
 * something is there already), keeps that column (`Step.pin`), and nothing
 * slides when a gate is moved or deleted. Pure functions from a tape to a new
 * tape, which the calculator applies as one undoable edit.
 *
 * The tape stays the order the circuit runs in: an entry dropped at a column
 * goes after every entry left of it on its wires and before every entry right
 * of it (entries on other wires commute with it, so their order doesn't
 * matter; when it has to, the tape is reordered without breaking any wire's
 * order). Rows are qubits (the editor draws every wire).
 */
import { layoutTape, reachesBus, type Layout, type Placed } from "./diagram";
import { measuredBit, writesBit, type Entry, type Step } from "./steps";

/** The rows a step keeps free in its column on `n` wires: its qubits, and down to the bus if it writes or reads a bit. */
const span = (s: Step, n: number): [number, number] => {
  const q = [...s.controls, ...s.targets];
  return [Math.min(...q), reachesBus(s) ? Math.max(n - 1, ...q) : Math.max(...q)];
};

/** Classical bit k as an ordering row (qubit rows are 0…n−1; bits sit below zero). */
const bitRow = (k: number) => -1 - k;

/** The rows an entry's steps touch for ordering: their spans, and the classical bits they read or write. */
function touches(e: Entry, cols: number[], n: number): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  e.forEach((s, k) => {
    const [lo, hi] = span(s, n);
    for (let r = lo; r <= hi; r++) out.push({ row: r, col: cols[k] });
    if (s.condition) out.push({ row: bitRow(s.condition.clbit), col: cols[k] });
    if (writesBit(s)) out.push({ row: bitRow(measuredBit(s)), col: cols[k] });
  });
  return out;
}

/** Each step pinned at the column it's drawn in: the circuit keeps its shape whatever is removed. */
export function pinAll(tape: Entry[], lay: Layout): Entry[] {
  const out = tape.map((e) => e.slice());
  for (const it of lay.items) {
    const s = out[it.entry][it.k];
    if (s.pin !== it.col) out[it.entry][it.k] = { ...s, pin: it.col };
  }
  return out;
}

/** Every pin removed: each gate as early as it can go (Quantiom's "compact columns"). */
export function compact(tape: Entry[]): Entry[] {
  return tape.map((e) => e.map((s) => {
    if (s.pin === undefined) return s;
    const { pin: _, ...rest } = s;
    return rest;
  }));
}

/** The columns of an entry's steps relative to its first column, as drawn alone (a QAOA ring's steps don't fit in one). */
export function shape(n: number, e: Entry): number[] {
  const lay = layoutTape(n, [e.map((s) => ({ ...s, pin: undefined }))]);
  return lay.items.map((it) => it.col);
}

/**
 * The first column at or right of `col` where an entry of this shape fits:
 * no other step drawn in the same column on an overlapping span.
 */
export function freeColumn(items: Placed[], e: Entry, rel: number[], col: number, skip = -1, n = Infinity): number {
  const byCol = new Map<number, [number, number][]>();
  for (const it of items) {
    if (it.entry === skip) continue;
    const l = byCol.get(it.col);
    if (l) l.push([it.lo, it.bottom]);
    else byCol.set(it.col, [[it.lo, it.bottom]]);
  }
  const rows = n === Infinity ? Math.max(0, ...items.map((it) => it.bottom)) + 1 : n;
  const clash = (c: number) => e.some((s, k) => {
    const [lo, hi] = span(s, rows);
    return (byCol.get(c + rel[k]) ?? []).some(([a, b]) => a <= hi && lo <= b);
  });
  let c = Math.max(0, col);
  while (clash(c)) c++;
  return c;
}

/** A binary min-heap of node ids by key. */
class Heap {
  private a: number[] = [];
  constructor(private key: (i: number) => number) {}
  get size() { return this.a.length; }
  push(i: number) {
    const a = this.a, k = this.key;
    a.push(i);
    let j = a.length - 1;
    while (j > 0) {
      const p = (j - 1) >> 1;
      if (k(a[p]) <= k(a[j])) break;
      [a[p], a[j]] = [a[j], a[p]];
      j = p;
    }
  }
  pop(): number {
    const a = this.a, k = this.key;
    const top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let j = 0;
      for (;;) {
        const l = 2 * j + 1, r = l + 1;
        let m = j;
        if (l < a.length && k(a[l]) < k(a[m])) m = l;
        if (r < a.length && k(a[r]) < k(a[m])) m = r;
        if (m === j) break;
        [a[m], a[j]] = [a[j], a[m]];
        j = m;
      }
    }
    return top;
  }
}

/**
 * Put entry `e`, pinned at its columns, into `tape` (laid out as `lay`):
 * after every entry drawn left of it on the rows it touches, before every
 * entry drawn right of it. Returns the new tape and e's index.
 */
export function insertPinned(tape: Entry[], lay: Layout, e: Entry): { tape: Entry[]; at: number } {
  const m = tape.length;
  const colsOf: number[][] = tape.map((x) => new Array(x.length).fill(0));
  for (const it of lay.items) colsOf[it.entry][it.k] = it.col;
  // Each row's entries in tape order, with the column they occupy it at.
  const rows = new Map<number, { entry: number; col: number }[]>();
  tape.forEach((x, i) => {
    const seen = new Set<number>();
    for (const t of touches(x, colsOf[i], lay.wires.length)) {
      if (seen.has(t.row)) continue;
      seen.add(t.row);
      const l = rows.get(t.row);
      if (l) l.push({ entry: i, col: t.col });
      else rows.set(t.row, [{ entry: i, col: t.col }]);
    }
  });
  const mine = touches(e, e.map((s) => s.pin ?? 0), lay.wires.length);
  // Where e goes on each of its rows: after the entries at or left of its column there.
  let before = -1, after = m;
  const cuts = new Map<number, number>();
  for (const t of mine) {
    const l = rows.get(t.row) ?? [];
    let j = 0;
    while (j < l.length && l[j].col <= t.col) j++;
    cuts.set(t.row, Math.min(cuts.get(t.row) ?? Infinity, j));
  }
  for (const [r, j] of cuts) {
    const l = rows.get(r) ?? [];
    if (j > 0) before = Math.max(before, l[j - 1].entry);
    if (j < l.length) after = Math.min(after, l[j].entry);
  }
  // Usually a place in the tape between the two exists.
  if (before < after) {
    const at = before + 1;
    return { tape: [...tape.slice(0, at), e, ...tape.slice(at)], at };
  }
  // Otherwise reorder: a topological sort of the wires' orders plus e's place on each row,
  // keeping the tape order wherever it is free to.
  const NEW = m;
  const next: number[][] = Array.from({ length: m + 1 }, () => []);
  const indeg = new Array<number>(m + 1).fill(0);
  const edge = (a: number, b: number) => { next[a].push(b); indeg[b]++; };
  for (const [r, l] of rows) {
    const j = cuts.get(r);
    const chain = l.map((x) => x.entry);
    if (j !== undefined) chain.splice(j, 0, NEW);
    for (let k = 1; k < chain.length; k++) edge(chain[k - 1], chain[k]);
  }
  const key = (i: number) => (i === NEW ? before + 0.5 : i);
  const heap = new Heap(key);
  for (let i = 0; i <= m; i++) if (!indeg[i]) heap.push(i);
  const order: number[] = [];
  while (heap.size) {
    const i = heap.pop();
    order.push(i);
    for (const j of next[i]) if (--indeg[j] === 0) heap.push(j);
  }
  if (order.length !== m + 1) {
    // No order draws e there (an entry spanning several columns in the way): after the last entry left of it.
    const at = before + 1;
    return { tape: [...tape.slice(0, at), e, ...tape.slice(at)], at };
  }
  return { tape: order.map((i) => (i === NEW ? e : tape[i])), at: order.indexOf(NEW) };
}

/** A new entry dropped at column `col`: in the first free column there or right of it. */
export function placeEntry(n: number, tape: Entry[], e: Entry, col: number): { tape: Entry[]; at: number; col: number } {
  const lay = layoutTape(n, tape);
  const rel = shape(n, e);
  const c = freeColumn(lay.items, e, rel, col, -1, n);
  const pinned = e.map((s, k) => ({ ...s, pin: c + rel[k] }));
  return { ...insertPinned(tape, lay, pinned), col: c };
}

/**
 * Entry i replaced by `entries` (a custom gate expanded into its steps) from
 * its own column on, each at the column it takes drawn alone; everything else
 * keeps its column, except what the longer run pushes right.
 */
export function expandAt(n: number, tape: Entry[], i: number, entries: Entry[]): Entry[] {
  const lay = layoutTape(n, tape);
  const pinned = pinAll(tape, lay);
  const own = Math.min(...lay.items.filter((it) => it.entry === i).map((it) => it.col));
  const alone = layoutTape(n, entries.map((e) => e.map((s) => ({ ...s, pin: undefined }))));
  const cols = entries.map((e) => e.map(() => 0));
  for (const it of alone.items) cols[it.entry][it.k] = it.col;
  const placed = entries.map((e, j) => e.map((s, k) => ({ ...s, pin: own + cols[j][k] })));
  return [...pinned.slice(0, i), ...placed, ...pinned.slice(i + 1)];
}

/**
 * The selected entries `set` replaced by one entry `group` (a gate made of
 * them), or null when that would change the circuit: some other entry sits
 * between two selected ones (it follows one on a wire or bit and precedes
 * another). The other entries keep their columns; the group goes at the
 * selection's first column, before everything that depended on it.
 */
export function groupEntries(n: number, tape: Entry[], set: Set<number>, group: Entry): Entry[] | null {
  const lay = layoutTape(n, tape);
  const pinned = pinAll(tape, lay);
  const rows = (e: Entry) => new Set(e.flatMap((s) => [...s.controls, ...s.targets, ...(writesBit(s) ? [-1 - measuredBit(s)] : []), ...(s.condition ? [-1 - s.condition.clbit] : [])]));
  const R = tape.map(rows);
  const shares = (i: number, j: number) => [...R[i]].some((r) => R[j].has(r));
  // Entries after the selection's first that depend on it, through anything unselected.
  const reach = new Set<number>();
  const first = Math.min(...set);
  for (let j = first + 1; j < tape.length; j++) {
    if (set.has(j)) continue;
    for (let i = first; i < j; i++) if ((set.has(i) || reach.has(i)) && shares(i, j)) { reach.add(j); break; }
  }
  for (const j of set) for (const r of reach) if (r < j && shares(r, j)) return null;
  const col = Math.min(...lay.items.filter((it) => set.has(it.entry)).map((it) => it.col));
  const g = group.map((s) => ({ ...s, pin: col }));
  const before = pinned.filter((_, i) => !set.has(i) && !reach.has(i));
  const after = pinned.filter((_, i) => reach.has(i));
  return [...before, g, ...after];
}

/** The column after the last gate on wires lo..hi (where a tapped tile goes without a chosen cell). */
export function endColumn(lay: Layout, lo: number, hi: number): number {
  let c = 0;
  for (const it of lay.items) if (it.lo <= hi && lo <= it.hi) c = Math.max(c, it.col + 1);
  return c;
}

/**
 * Entry i replaced by `next` (moved to other wires, a dot reassigned, a
 * control added) and placed at column `col` (its own column when omitted),
 * or the first free one right of it. Everything else keeps its column.
 */
export function repositionEntry(n: number, tape: Entry[], i: number, next: Entry, col?: number): { tape: Entry[]; at: number } {
  const lay = layoutTape(n, tape);
  const pinned = pinAll(tape, lay);
  const own = Math.min(...lay.items.filter((it) => it.entry === i).map((it) => it.col));
  const rest = pinned.filter((_, k) => k !== i);
  const restLay = layoutTape(n, rest);
  const rel = shape(n, next);
  const c = freeColumn(restLay.items, next, rel, col ?? own, -1, n);
  return insertPinned(rest, restLay, next.map((s, k) => ({ ...s, pin: c + rel[k] })));
}

/** Every qubit of the entry moved by dq wires, or null off the register. */
export function shiftEntry(e: Entry, dq: number, n: number): Entry | null {
  const q = e.flatMap((s) => [...s.controls, ...s.targets]);
  if (Math.min(...q) + dq < 0 || Math.max(...q) + dq >= n) return null;
  return e.map((s) => ({
    ...s, targets: s.targets.map((t) => t + dq), controls: s.controls.map((c) => c + dq),
    ...(s.condition ? { condition: { ...s.condition } } : {}),
  }));
}

/** Entry i dragged to column `col`, dq wires down (null off the register). */
export function moveEntry(n: number, tape: Entry[], i: number, col: number, dq: number): { tape: Entry[]; at: number } | null {
  const moved = dq ? shiftEntry(tape[i], dq, n) : tape[i];
  return moved ? repositionEntry(n, tape, i, moved, col) : null;
}

/** The entries in `set` removed; everything else keeps its column. */
export function removeEntries(n: number, tape: Entry[], set: Set<number>): Entry[] {
  return pinAll(tape, layoutTape(n, tape)).filter((_, k) => !set.has(k));
}

/** A copied selection: its entries in tape order, columns relative to the leftmost. */
export type Clip = { entries: Entry[] };

export function copyEntries(n: number, tape: Entry[], set: Set<number>): Clip {
  const lay = layoutTape(n, tape);
  const chosen = lay.items.filter((it) => set.has(it.entry));
  const min = Math.min(...chosen.map((it) => it.col));
  const pinned = pinAll(tape, lay);
  const entries = [...set].sort((a, b) => a - b).map((i) => pinned[i].map(({ outcome: _, ...s }) => ({ ...s, pin: (s.pin ?? 0) - min })));
  return { entries };
}

/**
 * The clipboard pasted after the circuit's last column (Quantiom's paste),
 * with fresh ids from `newId`. Entries on qubits the register lacks are skipped.
 */
export function pasteClip(n: number, tape: Entry[], clip: Clip, newId: () => string): { tape: Entry[]; added: number } {
  const lay = layoutTape(n, tape);
  const base = lay.cols;
  const fits = (e: Entry) => e.every((s) => [...s.controls, ...s.targets].every((q) => q < n));
  const add = clip.entries.filter(fits).map((e) => e.map((s) => ({ ...s, id: newId(), pin: base + (s.pin ?? 0) })));
  return { tape: [...tape, ...add], added: add.length };
}

/** The entries with a step drawn inside the rectangle of columns c0..c1 and rows r0..r1. */
export function entriesIn(lay: Layout, c0: number, c1: number, r0: number, r1: number): Set<number> {
  const out = new Set<number>();
  for (const it of lay.items) if (it.col >= c0 && it.col <= c1 && it.lo <= r1 && r0 <= it.hi) out.add(it.entry);
  return out;
}
