import { applyStep, type Entry } from "./steps";

export const MAX_QUBITS = 20;

/** Memory kept for undo snapshots, in bytes. */
const SNAPSHOT_BUDGET = 32 * 1024 * 1024;

function ground(n: number): Float64Array {
  const s = new Float64Array(2 << n);
  s[0] = 1;
  return s;
}

/**
 * The calculator's quantum register: a live statevector plus the tape of
 * entries that produced it. Gates apply incrementally (O(2ⁿ) per key press).
 * Undo restores the nearest snapshot and replays forward; snapshots are
 * taken every `interval` entries, sparser as n grows, within a fixed budget.
 */
export class Register {
  n: number;
  state: Float64Array;
  tape: Entry[] = [];
  redoStack: Entry[] = [];
  private snapshots = new Map<number, Float64Array>();

  constructor(n: number, tape: Entry[] = []) {
    this.n = n;
    this.state = ground(n);
    this.replay(tape);
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

  private replay(tape: Entry[]): void {
    for (const e of tape) this.apply(e, Math.random);
  }

  private apply(entry: Entry, rng: () => number): Entry {
    const done = entry.map((s) => applyStep(this.state, this.n, s, rng));
    this.tape.push(done);
    this.snapshot();
    return done;
  }

  /** Apply a new entry (fresh measurements are sampled with `rng`). */
  push(entry: Entry, rng: () => number = Math.random): Entry {
    this.redoStack = [];
    return this.apply(entry, rng);
  }

  undo(): Entry | null {
    const last = this.tape.pop();
    if (!last) return null;
    this.redoStack.push(last);
    const len = this.tape.length;
    for (const k of [...this.snapshots.keys()]) if (k > len) this.snapshots.delete(k);
    let from = 0;
    for (const k of this.snapshots.keys()) if (k <= len && k > from) from = k;
    const snap = this.snapshots.get(from);
    this.state = snap ? snap.slice() : ground(this.n);
    const rest = this.tape.splice(from);
    this.replay(rest);
    return last;
  }

  redo(): Entry | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    return this.apply(e, Math.random);
  }

  /** Highest qubit index the tape touches, or −1. */
  maxQubitUsed(): number {
    let m = -1;
    for (const e of this.tape) for (const s of e) for (const q of [...s.controls, ...s.targets]) m = Math.max(m, q);
    return m;
  }

  /** Change register width and replay the tape. Throws if a qubit in use would vanish. */
  resize(n: number): void {
    if (n < 1 || n > MAX_QUBITS) throw new Error(`n must be 1–${MAX_QUBITS}`);
    const used = this.maxQubitUsed();
    if (n <= used) throw new Error(`q${used} in use`);
    const tape = this.tape;
    const redo = this.redoStack;
    this.n = n;
    this.state = ground(n);
    this.tape = [];
    this.snapshots.clear();
    this.replay(tape);
    this.redoStack = redo.filter((e) => e.every((s) => [...s.controls, ...s.targets].every((q) => q < n)));
  }

  clear(): void {
    this.state = ground(this.n);
    this.tape = [];
    this.redoStack = [];
    this.snapshots.clear();
  }
}
