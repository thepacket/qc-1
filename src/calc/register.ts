import { applyStep, classicalBits, stepSymbols, type Entry, type Scope } from "./steps";

export const MAX_QUBITS = 20;

/** Memory kept for undo snapshots, in bytes. */
const SNAPSHOT_BUDGET = 32 * 1024 * 1024;

function ground(n: number): Float64Array {
  const s = new Float64Array(2 << n);
  s[0] = 1;
  return s;
}

/** A whole register: what `replace` swaps in and out. */
export type Contents = { n: number; tape: Entry[]; scope: Scope };

/**
 * One undoable operation: a single appended entry, or a whole-tape
 * replacement (AC, RCL, circuit tools, imports), which undo swaps back.
 */
export type Op = { k: "entry"; entry: Entry } | { k: "replace"; before: Contents; after: Contents; label: string };

/** Symbols (ASCII names) an entry's parameters use. */
export function entrySymbols(e: Entry): string[] {
  return e.flatMap(stepSymbols);
}

/**
 * The calculator's quantum register: a live statevector plus the tape of
 * entries that produced it, under a symbol scope (values of t, θ, …).
 *
 * Gates apply incrementally (O(2ⁿ) per key press). Undo restores the
 * nearest snapshot and replays forward; snapshots are taken every
 * `interval` entries, sparser as n grows, within a fixed budget.
 *
 * Changing a symbol value replays only from the first entry that uses a
 * symbol, starting from a cached prefix state. Replays force each
 * measurement's recorded outcome unless it has become impossible, in which
 * case it is re-sampled and reported in `notes`.
 */
export class Register {
  n: number;
  state: Float64Array;
  /** Classical register after the tape: c[q] = last outcome measured on q. */
  cbits: Uint8Array;
  tape: Entry[] = [];
  scope: Scope;
  ops: Op[] = [];
  redoOps: Op[] = [];
  /** Messages from the last operation (e.g. a re-sampled measurement). */
  notes: string[] = [];
  private snapshots = new Map<number, Float64Array>();
  /** State just before the first symbolic entry, for fast scope replays. */
  private prefix: { idx: number; state: Float64Array } | null = null;

  constructor(n: number, tape: Entry[] = [], scope: Scope = {}) {
    this.n = n;
    this.scope = { ...scope };
    this.state = ground(n);
    this.cbits = new Uint8Array(n);
    this.replay(tape);
    this.ops = this.tape.map((entry) => ({ k: "entry", entry }));
  }

  private get interval(): number {
    return Math.min(64, Math.max(1, 1 << Math.max(0, this.n - 10)));
  }

  private snapshot(): void {
    const len = this.tape.length;
    if (len % this.interval !== 0) return;
    this.snapshots.set(len, this.state.slice());
    const bytes = this.state.byteLength;
    while (this.snapshots.size * bytes > SNAPSHOT_BUDGET) {
      const oldest = Math.min(...this.snapshots.keys());
      this.snapshots.delete(oldest);
    }
  }

  /** Give every symbol used by the tape a value (new symbols start at 0). */
  private defineSymbols(entries: Entry[]) {
    for (const e of entries) for (const v of entrySymbols(e)) if (!(v in this.scope)) this.scope[v] = 0;
  }

  private replay(tape: Entry[]): void {
    for (const e of tape) this.apply(e, Math.random);
  }

  private apply(entry: Entry, rng: () => number): Entry {
    this.defineSymbols([entry]);
    const done = entry.map((s) => applyStep(this.state, this.n, s, rng, this.scope, this.cbits));
    done.forEach((s, i) => {
      const was = entry[i].outcome;
      if (was !== undefined && s.outcome !== was) {
        this.notes.push(`measurement at step ${this.tape.length + 1} changed ${was}→${s.outcome}`);
      }
    });
    this.tape.push(done);
    this.snapshot();
    return done;
  }

  /** Index of the first entry that uses a symbol (tape length if none). */
  firstSymbolic(): number {
    const i = this.tape.findIndex((e) => entrySymbols(e).length > 0);
    return i < 0 ? this.tape.length : i;
  }

  /** Symbols the tape uses, sorted. */
  symbols(): string[] {
    return [...new Set(this.tape.flatMap(entrySymbols))].sort();
  }

  /** Apply a new entry (fresh measurements are sampled with `rng`). */
  push(entry: Entry, rng: () => number = Math.random): Entry {
    this.notes = [];
    this.redoOps = [];
    const done = this.apply(entry, rng);
    this.ops.push({ k: "entry", entry: done });
    return done;
  }

  /** Rebuild the state from snapshot/ground at index `from` onwards. */
  private rebuildFrom(len: number) {
    for (const k of [...this.snapshots.keys()]) if (k > len) this.snapshots.delete(k);
    let from = 0;
    for (const k of this.snapshots.keys()) if (k <= len && k > from) from = k;
    if (this.prefix && this.prefix.idx <= len && this.prefix.idx > from) {
      from = this.prefix.idx;
      this.state = this.prefix.state.slice();
    } else {
      const snap = this.snapshots.get(from);
      this.state = snap ? snap.slice() : ground(this.n);
    }
    this.cbits = classicalBits(this.n, this.tape, from);
    const rest = this.tape.splice(from);
    this.replay(rest.slice(0, len - from));
  }

  /**
   * The state after the first `len` entries, without touching the register
   * (TAPE scrubber). Starts from the nearest snapshot or the prefix cache and
   * replays with the recorded measurement outcomes.
   */
  stateAt(len: number): Float64Array {
    if (len >= this.tape.length) return this.state;
    let from = 0;
    for (const k of this.snapshots.keys()) if (k <= len && k > from) from = k;
    let state: Float64Array;
    if (this.prefix && this.prefix.idx <= len && this.prefix.idx > from) {
      from = this.prefix.idx;
      state = this.prefix.state.slice();
    } else {
      const snap = this.snapshots.get(from);
      state = snap ? snap.slice() : ground(this.n);
    }
    const cbits = classicalBits(this.n, this.tape, from);
    for (let i = from; i < len; i++) for (const s of this.tape[i]) applyStep(state, this.n, s, Math.random, this.scope, cbits);
    return state;
  }

  undo(): Op | null {
    this.notes = [];
    const op = this.ops.pop();
    if (!op) return null;
    this.redoOps.push(op);
    if (op.k === "replace") {
      this.load(op.before);
      return op;
    }
    const len = this.tape.length - 1;
    if (this.prefix && this.prefix.idx > len) this.prefix = null;
    this.rebuildFrom(len);
    return op;
  }

  redo(): Op | null {
    this.notes = [];
    const op = this.redoOps.pop();
    if (!op) return null;
    if (op.k === "replace") this.load(op.after);
    else this.apply(op.entry, Math.random);
    this.ops.push(op);
    return op;
  }

  /** Swap in whole new contents as one undoable operation. */
  replace(after: Contents, label: string): void {
    this.notes = [];
    const before = this.contents();
    this.load(after);
    this.ops.push({ k: "replace", before, after: this.contents(), label });
    this.redoOps = [];
  }

  /** A copy of the register's contents (the tape array is mutated in place later). */
  contents(): Contents {
    return { n: this.n, tape: [...this.tape], scope: { ...this.scope } };
  }

  private load(c: Contents) {
    this.n = c.n;
    this.scope = { ...c.scope };
    this.state = ground(this.n);
    this.cbits = new Uint8Array(this.n);
    this.tape = [];
    this.snapshots.clear();
    this.prefix = null;
    this.replay(c.tape);
  }

  /**
   * Change symbol values and replay from the first symbolic entry. Measurement
   * outcomes that became impossible are re-sampled (see `notes`).
   */
  setScope(values: Scope): void {
    this.notes = [];
    const changed = Object.entries(values).some(([k, v]) => this.scope[k] !== v);
    Object.assign(this.scope, values);
    if (!changed) return;
    const idx = this.firstSymbolic();
    if (idx >= this.tape.length) return;
    const rest = this.tape.slice(idx);
    if (!this.prefix || this.prefix.idx !== idx) {
      this.rebuildFrom(idx); // leaves the tape at idx entries
      this.prefix = { idx, state: this.state.slice() };
    } else {
      this.state = this.prefix.state.slice();
      this.cbits = classicalBits(this.n, this.tape, idx);
      this.tape.splice(idx);
    }
    for (const k of [...this.snapshots.keys()]) if (k > idx) this.snapshots.delete(k);
    this.replay(rest);
    // The recorded outcomes in the undo history must follow the new tape: the
    // trailing entry ops map onto the tape's tail, up to the latest replace.
    for (let k = this.ops.length - 1, i = this.tape.length - 1; k >= 0 && i >= idx; k--, i--) {
      const op = this.ops[k];
      if (op.k !== "entry") break;
      op.entry = this.tape[i];
    }
  }

  /** Highest qubit index the tape touches, or −1. */
  maxQubitUsed(): number {
    let m = -1;
    for (const e of this.tape) for (const s of e) for (const q of [...s.controls, ...s.targets]) m = Math.max(m, q);
    return m;
  }

  /** Change register width and replay the tape. Throws if a qubit in use would vanish. */
  resize(n: number): void {
    this.notes = [];
    if (n < 1 || n > MAX_QUBITS) throw new Error(`n must be 1–${MAX_QUBITS}`);
    const used = this.maxQubitUsed();
    if (n <= used) throw new Error(`q${used} in use`);
    const tape = this.tape;
    this.n = n;
    this.state = ground(n);
    this.cbits = new Uint8Array(n);
    this.tape = [];
    this.snapshots.clear();
    this.prefix = null;
    this.replay(tape);
    const fits = (e: Entry) => e.every((s) => [...s.controls, ...s.targets].every((q) => q < n));
    this.redoOps = this.redoOps.filter((op) => (op.k === "entry" ? fits(op.entry) : op.after.n === n));
  }

  /** AC: empty the tape, as an undoable replace. */
  clear(): void {
    this.replace({ n: this.n, tape: [], scope: this.scope }, "AC");
  }
}
