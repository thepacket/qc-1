import { Core, type Cmd, type Result, type ViewData, type ViewReq } from "./core";

/**
 * Transport between the calculator (UI thread) and the simulator Core.
 * Replies come back in command order; a view summary follows each batch
 * of commands (coalesced, so a burst of key presses computes one view).
 */
export interface Engine {
  send(cmd: Cmd): void;
  onResult: (r: Result) => void;
  onView: (v: ViewData) => void;
}

export type WorkerIn = { cmd: Cmd };
export type WorkerOut = { result: Result } | { view: ViewData };

/** Synchronous in-process engine: tests, and browsers without module workers. */
export class InlineEngine implements Engine {
  core = new Core();
  private req: ViewReq = { mode: "ket", shots: 1024, shotSeed: 0 };
  onResult: (r: Result) => void = () => {};
  onView: (v: ViewData) => void = () => {};

  send(cmd: Cmd) {
    if (cmd.t === "view") this.req = cmd.req;
    this.onResult(this.core.handle(cmd));
    this.onView(this.core.view(this.req));
  }
}

export class WorkerEngine implements Engine {
  private worker: Worker;
  onResult: (r: Result) => void = () => {};
  onView: (v: ViewData) => void = () => {};

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      if ("result" in e.data) this.onResult(e.data.result);
      else this.onView(e.data.view);
    };
  }

  send(cmd: Cmd) {
    this.worker.postMessage({ cmd } satisfies WorkerIn);
  }
}

export function createEngine(): Engine {
  try {
    if (typeof Worker !== "undefined") return new WorkerEngine();
  } catch {
    /* module workers unsupported */
  }
  return new InlineEngine();
}
