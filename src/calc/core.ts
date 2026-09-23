import { Register } from "./register";
import { bloch, sampleState, topK, type Vec3 } from "./analysis";
import type { Entry, Scope } from "./steps";
import type { Op } from "./register";

/**
 * The simulator side of the calculator: owns the Register (statevector,
 * tape, undo snapshots) and answers commands with small replies. Runs in a
 * Web Worker in the app (worker.ts) and inline in tests.
 */

export type Mode = "ket" | "prob" | "bloch" | "shots" | "tape" | "lab";

/** `upTo`: show the state after that many tape entries (TAPE scrubber); null = the end. */
export type ViewReq = { mode: Mode; shots: number; shotSeed: number; upTo?: number | null };

export type ViewData = { n: number; /** Scrubbed to this many entries (else the end). */ at?: number } & (
  | { mode: "ket"; rows: { i: number; re: number; im: number }[]; nonzero: number }
  | { mode: "prob"; rows: { i: number; p: number }[]; complete: boolean }
  | { mode: "bloch"; vectors: Vec3[] }
  | { mode: "shots"; rows: { i: number; count: number }[]; distinct: number; shots: number }
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
  | { t: "view"; req: ViewReq };

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

export class Core {
  reg = new Register(2);
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
        case "undo": op = this.reg.undo(); break;
        case "redo": op = this.reg.redo(); break;
        case "replace":
          this.check2(cmd.n, cmd.tape);
          this.reg.replace({ n: cmd.n, tape: cmd.tape, scope: cmd.scope }, cmd.label);
          break;
        case "resize": this.reg.resize(cmd.n); break;
        case "clear": this.reg.clear(); break;
        case "load":
          try {
            this.reg = new Register(cmd.n, cmd.tape, cmd.scope);
          } catch {
            this.reg = new Register(2);
            throw new Error("saved session unreadable");
          }
          break;
        case "view": break;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (cmd.t !== "view" && !error) this.rev++;
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

  /** A replacement tape must fit its register. */
  private check2(n: number, tape: Entry[]) {
    if (n < 1 || n > 20) throw new Error("n must be 1–20");
    for (const e of tape) for (const s of e) for (const q of [...s.controls, ...s.targets]) {
      if (q >= n) throw new Error(`no q${q} (n=${n})`);
    }
  }

  /** A private copy of the register for the analysis worker. */
  snapshot(): { rev: number; n: number; tape: Entry[]; scope: Scope; state: Float64Array } {
    this.flush();
    return { rev: this.rev, n: this.reg.n, tape: this.reg.tape, scope: { ...this.reg.scope }, state: this.reg.state.slice() };
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
    const data = this.viewOf(req, at === undefined ? this.reg.state : this.reg.stateAt(at));
    return at === undefined ? data : { ...data, at };
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
