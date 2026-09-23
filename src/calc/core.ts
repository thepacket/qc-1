import { Register } from "./register";
import { bloch, sampleState, topK, type Vec3 } from "./analysis";
import type { Entry } from "./steps";

/**
 * The simulator side of the calculator: owns the Register (statevector,
 * tape, undo snapshots) and answers commands with small replies. Runs in a
 * Web Worker in the app (worker.ts) and inline in tests.
 */

export type Mode = "ket" | "prob" | "bloch" | "shots" | "tape";

export type ViewReq = { mode: Mode; shots: number; shotSeed: number };

export type ViewData = { n: number } & (
  | { mode: "ket"; rows: { i: number; re: number; im: number }[]; nonzero: number }
  | { mode: "prob"; rows: { i: number; p: number }[]; complete: boolean }
  | { mode: "bloch"; vectors: Vec3[] }
  | { mode: "shots"; rows: { i: number; count: number }[]; distinct: number; shots: number }
  | { mode: "tape" }
);

export type Cmd =
  | { t: "push"; entry: Entry }
  | { t: "repeat" }
  | { t: "undo" }
  | { t: "redo" }
  | { t: "resize"; n: number }
  | { t: "clear" }
  | { t: "load"; n: number; tape: Entry[] }
  | { t: "view"; req: ViewReq };

export type Result = {
  n: number;
  tape: Entry[];
  redo: number;
  /** The entry pushed / undone / redone; null when there was nothing to do. */
  done?: Entry | null;
  error?: string;
};

export const KET_ROWS = 64;
const BAR_ROWS = 32;

let repeatId = 0;

export class Core {
  reg = new Register(2);

  handle(cmd: Cmd): Result {
    let done: Entry | null | undefined;
    let error: string | undefined;
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
        case "undo": done = this.reg.undo(); break;
        case "redo": done = this.reg.redo(); break;
        case "resize": this.reg.resize(cmd.n); break;
        case "clear": this.reg.clear(); break;
        case "load":
          try {
            this.reg = new Register(cmd.n, cmd.tape);
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
    return { n: this.reg.n, tape: this.reg.tape, redo: this.reg.redoStack.length, done, error };
  }

  /** Reject steps that address qubits outside the register (a resize may have raced ahead). */
  private check(entry: Entry) {
    for (const s of entry) for (const q of [...s.controls, ...s.targets]) {
      if (q >= this.reg.n) throw new Error(`no q${q} (n=${this.reg.n})`);
    }
  }

  view(req: ViewReq): ViewData {
    const { n, state } = this.reg;
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
    }
  }
}
