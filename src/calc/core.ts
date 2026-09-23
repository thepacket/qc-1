import { MAX_QUBITS, Register, type Contents } from "./register";
import { StabilizerRegister, STAB_MAX } from "../stab/register";
import type { Stabilizer } from "../sim/stabilizer";
import { bloch, sampleState, topK, type Vec3 } from "./analysis";
import type { Entry, Scope } from "./steps";
import type { Op } from "./register";
import { customGates, setCustomGates, type CustomGate } from "./custom";

/**
 * The simulator side of the calculator: owns the Register (statevector,
 * tape, undo snapshots) and answers commands with small replies. Runs in a
 * Web Worker in the app (worker.ts) and inline in tests.
 */

export type Mode = "ket" | "prob" | "bloch" | "shots" | "tape" | "lab";

/** `upTo`: show the state after that many tape entries (TAPE scrubber); null = the end. */
export type ViewReq = { mode: Mode; shots: number; shotSeed: number; upTo?: number | null };

export type ViewData = {
  n: number;
  /** Scrubbed to this many entries (else the end). */
  at?: number;
  /** Stabilizer mode (n > 20): generators, marginals, bitstring shots. */
  stab?: boolean;
} & (
  | { mode: "ket"; rows: { i: number; re: number; im: number }[]; nonzero: number; generators?: string[] }
  | { mode: "prob"; rows: { i: number; p: number }[]; complete: boolean; marginals?: number[] }
  | { mode: "bloch"; vectors: Vec3[] }
  | { mode: "shots"; rows: { i: number; count: number; bits?: string }[]; distinct: number; shots: number }
  | { mode: "tape" }
  | { mode: "lab" }
);

export type Cmd =
  | { t: "push"; entry: Entry }
  | { t: "repeat" }
  | { t: "undo" }
  | { t: "redo" }
  | { t: "resize"; n: number }
  | { t: "clear" }
  | { t: "load"; n: number; tape: Entry[]; scope?: Scope }
  /** Set symbol values; coalesced, applied before the next view/command. */
  | { t: "scope"; values: Scope }
  /** Swap in whole new contents as one undoable operation. */
  | { t: "replace"; n: number; tape: Entry[]; scope: Scope; label: string }
  /** Insert an entry before tape index `at` (null: a copy of the entry before it, the = key); undoable. */
  | { t: "insert"; at: number; entry: Entry | null }
  /** Remove the entry at tape index `at`; undoable. */
  | { t: "delete"; at: number }
  | { t: "view"; req: ViewReq }
  /** Custom gate definitions (set before a load/replace that uses them). */
  | { t: "gates"; defs: CustomGate[] };

export type Result = {
  /** Bumped on every change to the register; analyses use it to go stale. */
  rev: number;
  n: number;
  tape: Entry[];
  scope: Scope;
  /** Symbols the tape uses (ASCII names, sorted). */
  symbols: string[];
  redo: number;
  /** The entry pushed; null when there was nothing to do. */
  done?: Entry | null;
  /** The operation undone / redone; null when there was nothing to do. */
  op?: Op | null;
  /** Notes from the operation (e.g. a re-sampled measurement). */
  notes?: string[];
  error?: string;
};

export const KET_ROWS = 64;
const BAR_ROWS = 32;

let repeatId = 0;

type AnyRegister = Register | StabilizerRegister;
const stabFor = (n: number) => n > MAX_QUBITS;
/** The register kind for these contents: statevector up to 20 qubits, stabilizer tableau above. */
function registerFor(c: Contents): AnyRegister {
  return stabFor(c.n) ? new StabilizerRegister(c.n, c.tape, c.scope) : new Register(c.n, c.tape, c.scope);
}

const STAB_ROWS = 128;
/** Work budget for sampling shots from a tableau (each shot measures every qubit, O(n²) each). */
const SHOT_BUDGET = 3e8;

export class Core {
  reg: AnyRegister = new Register(2);
  rev = 0;
  /** Symbol values waiting to be applied (a slider sends a burst). */
  private pendingScope: Scope | null = null;

  /** Apply coalesced symbol values now (before anything reads the state). True if it did. */
  flush(): boolean {
    if (!this.pendingScope) return false;
    const v = this.pendingScope;
    this.pendingScope = null;
    this.reg.setScope(v);
    return true;
  }

  handle(cmd: Cmd): Result {
    let done: Entry | null | undefined;
    let op: Op | null | undefined;
    let error: string | undefined;
    if (cmd.t === "scope") {
      this.pendingScope = { ...this.pendingScope, ...cmd.values };
      this.rev++;
      return this.result({});
    }
    this.flush();
    try {
      switch (cmd.t) {
        case "push":
          this.check(cmd.entry);
          done = this.reg.push(cmd.entry);
          break;
        case "repeat": {
          const last = this.reg.tape[this.reg.tape.length - 1];
          if (!last) throw new Error("nothing to repeat");
          const col = this.reg.tape.length;
          done = this.reg.push(last.map((s) => ({ ...s, id: `r${repeatId++}`, column: col, outcome: undefined })));
          break;
        }
        case "undo": {
          // An undo that crosses 20 qubits changes the register kind: rebuild from the op's contents.
          const top = this.reg.ops[this.reg.ops.length - 1];
          if (top?.k === "replace" && stabFor(top.before.n) !== this.isStab) {
            this.switchTo(registerFor(top.before), this.reg.ops.slice(0, -1), [...this.reg.redoOps, top]);
            op = top;
          } else op = this.reg.undo();
          break;
        }
        case "redo": {
          const top = this.reg.redoOps[this.reg.redoOps.length - 1];
          if (top?.k === "replace" && stabFor(top.after.n) !== this.isStab) {
            this.switchTo(registerFor(top.after), [...this.reg.ops, top], this.reg.redoOps.slice(0, -1));
            op = top;
          } else op = this.reg.redo();
          break;
        }
        case "insert": {
          const tape = this.reg.tape;
          if (!(cmd.at >= 0 && cmd.at <= tape.length)) throw new Error(`no step ${cmd.at}`);
          const prev = tape[cmd.at - 1];
          const entry = cmd.entry ?? prev?.map((s) => ({ ...s, id: `r${repeatId++}`, outcome: undefined }));
          if (!entry) throw new Error("nothing to repeat");
          this.check(entry);
          this.reg.replace({ n: this.reg.n, tape: [...tape.slice(0, cmd.at), entry, ...tape.slice(cmd.at)], scope: this.reg.scope }, `insert at ${cmd.at + 1}`);
          done = this.reg.tape[cmd.at];
          break;
        }
        case "delete": {
          const tape = this.reg.tape;
          if (!(cmd.at >= 0 && cmd.at < tape.length)) throw new Error(`no step ${cmd.at + 1}`);
          this.reg.replace({ n: this.reg.n, tape: tape.filter((_, i) => i !== cmd.at), scope: this.reg.scope }, `delete step ${cmd.at + 1}`);
          break;
        }
        case "replace":
          this.check2(cmd.n, cmd.tape);
          if (stabFor(cmd.n) !== this.isStab) {
            const before = this.reg.contents();
            const next = registerFor({ n: cmd.n, tape: cmd.tape, scope: cmd.scope });
            this.switchTo(next, [...this.reg.ops, { k: "replace", before, after: next.contents(), label: cmd.label }], []);
          } else this.reg.replace({ n: cmd.n, tape: cmd.tape, scope: cmd.scope }, cmd.label);
          break;
        case "resize":
          if (cmd.n < 1 || cmd.n > STAB_MAX) throw new Error(`n must be 1–${STAB_MAX}`);
          if (stabFor(cmd.n) !== this.isStab) {
            const used = Math.max(-1, ...this.reg.tape.flat().flatMap((s) => [...s.controls, ...s.targets]));
            if (cmd.n <= used) throw new Error(`q${used} in use`);
            this.switchTo(registerFor({ n: cmd.n, tape: this.reg.tape, scope: this.reg.scope }), this.reg.ops, this.reg.redoOps);
          } else this.reg.resize(cmd.n);
          break;
        case "clear": this.reg.clear(); break;
        case "load":
          try {
            this.reg = registerFor({ n: cmd.n, tape: cmd.tape, scope: cmd.scope ?? {} });
          } catch {
            this.reg = new Register(2);
            throw new Error("saved session unreadable");
          }
          break;
        case "view": break;
        case "gates": setCustomGates(cmd.defs); break;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (cmd.t !== "view" && cmd.t !== "gates" && !error) this.rev++;
    return this.result({ done, op, error });
  }

  /** The register as the UI mirrors it (copies: the tape is mutated in place). */
  result(extra: Partial<Result> = {}): Result {
    const notes = this.reg.notes.length ? [...this.reg.notes] : undefined;
    return {
      rev: this.rev, n: this.reg.n, tape: [...this.reg.tape], scope: { ...this.reg.scope, ...this.pendingScope },
      symbols: this.reg.symbols(), redo: this.reg.redoOps.length, notes, ...extra,
    };
  }

  get isStab(): boolean {
    return this.reg instanceof StabilizerRegister;
  }

  /** Swap in a register of the other kind, carrying the undo and redo history. */
  private switchTo(next: AnyRegister, ops: Op[], redo: Op[]) {
    next.ops = ops;
    next.redoOps = redo;
    this.reg = next;
  }

  /** A replacement tape must fit its register. */
  private check2(n: number, tape: Entry[]) {
    if (n < 1 || n > STAB_MAX) throw new Error(`n must be 1–${STAB_MAX}`);
    for (const e of tape) for (const s of e) for (const q of [...s.controls, ...s.targets]) {
      if (q >= n) throw new Error(`no q${q} (n=${n})`);
    }
  }

  /** A private copy of the register for the analysis worker. */
  snapshot(): { rev: number; n: number; tape: Entry[]; scope: Scope; state: Float64Array; gates: CustomGate[]; stab: boolean } {
    this.flush();
    const state = this.reg instanceof Register ? this.reg.state.slice() : new Float64Array(0);
    return { rev: this.rev, n: this.reg.n, tape: this.reg.tape, scope: { ...this.reg.scope }, state, gates: customGates(), stab: this.isStab };
  }

  /** Reject steps that address qubits outside the register (a resize may have raced ahead). */
  private check(entry: Entry) {
    for (const s of entry) for (const q of [...s.controls, ...s.targets]) {
      if (q >= this.reg.n) throw new Error(`no q${q} (n=${this.reg.n})`);
    }
  }

  view(req: ViewReq): ViewData {
    this.flush();
    const len = this.reg.tape.length;
    const at = req.upTo != null && req.upTo < len ? Math.max(0, req.upTo) : undefined;
    const reg = this.reg;
    const data = reg instanceof StabilizerRegister
      ? this.stabView(req, at === undefined ? reg.tab : reg.tableauAt(at))
      : this.viewOf(req, at === undefined ? reg.state : reg.stateAt(at));
    return at === undefined ? data : { ...data, at };
  }

  /** Views of a stabilizer state: generators, per-qubit P(1), exact Bloch vectors, sampled bitstrings. */
  private stabView(req: ViewReq, tab: Stabilizer): ViewData {
    const n = this.reg.n;
    const single = (q: number, p: "X" | "Y" | "Z") => tab.pauliExpectation(Array.from({ length: n }, (_, i) => (i === q ? p : "I")));
    switch (req.mode) {
      case "ket": return { n, stab: true, mode: "ket", rows: [], nonzero: 0, generators: tab.stabilizers().slice(0, STAB_ROWS) };
      case "prob": return { n, stab: true, mode: "prob", rows: [], complete: false, marginals: Array.from({ length: Math.min(n, STAB_ROWS) }, (_, q) => (1 - single(q, "Z")) / 2) };
      case "bloch": return { n, stab: true, mode: "bloch", vectors: Array.from({ length: Math.min(n, 32) }, (_, q) => ({ x: single(q, "X"), y: single(q, "Y"), z: single(q, "Z") })) };
      case "shots": {
        const shots = Math.max(1, Math.min(req.shots, Math.floor(SHOT_BUDGET / (n * n * n))));
        let seed = 0x5407 + req.shotSeed;
        const rng = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32);
        const counts = new Map<string, number>();
        for (let s = 0; s < shots; s++) {
          const t = tab.clone();
          let bits = "";
          for (let q = 0; q < n; q++) bits += t.measureZ(q, rng);
          counts.set(bits, (counts.get(bits) ?? 0) + 1);
        }
        const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        return { n, stab: true, mode: "shots", shots, distinct: rows.length, rows: rows.slice(0, BAR_ROWS).map(([bits, count], i) => ({ i, count, bits })) };
      }
      case "tape": return { n, mode: "tape" };
      case "lab": return { n, mode: "lab" };
    }
  }

  private viewOf(req: ViewReq, state: Float64Array): ViewData {
    const { n } = this.reg;
    const p = (i: number) => state[2 * i] ** 2 + state[2 * i + 1] ** 2;
    switch (req.mode) {
      case "ket": {
        const { idx, nonzero } = topK(state, KET_ROWS);
        // Few terms → basis order reads like Dirac notation; many → most likely first.
        const order = nonzero <= KET_ROWS ? [...idx].sort((a, b) => a - b) : idx;
        return { n, mode: "ket", nonzero, rows: order.map((i) => ({ i, re: state[2 * i], im: state[2 * i + 1] })) };
      }
      case "prob": {
        if (n <= 4) return { n, mode: "prob", complete: true, rows: [...Array(1 << n).keys()].map((i) => ({ i, p: p(i) })) };
        return { n, mode: "prob", complete: false, rows: topK(state, BAR_ROWS).idx.map((i) => ({ i, p: p(i) })) };
      }
      case "bloch":
        return { n, mode: "bloch", vectors: [...Array(n).keys()].map((q) => bloch(state, n, q)) };
      case "shots": {
        const hit = [...sampleState(state, req.shots).entries()].sort((a, b) => b[1] - a[1]);
        return {
          n, mode: "shots", shots: req.shots, distinct: hit.length,
          rows: hit.slice(0, BAR_ROWS).map(([i, count]) => ({ i, count })),
        };
      }
      case "tape":
        return { n, mode: "tape" };
      case "lab":
        return { n, mode: "lab" };
    }
  }
}
