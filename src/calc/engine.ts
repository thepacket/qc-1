import { Core, type Cmd, type Result, type ViewData, type ViewReq } from "./core";
import type { AnalysisContext, AnalysisReply, AnalysisRequest, AnalysisResult, Opts } from "../analysis/types";

/**
 * Transport between the calculator (UI thread) and the simulator Core.
 * Replies come back in command order; a view summary follows each batch
 * of commands (coalesced, so a burst of key presses computes one view).
 * Analyses run separately (a second worker) and can be cancelled.
 */
export interface Engine {
  send(cmd: Cmd): void;
  analyze(req: AnalysisRequest): void;
  /** Abandon any running analysis (restarts the analysis worker). */
  cancelAnalysis(): void;
  onResult: (r: Result) => void;
  /** Register update not tied to a command (after a coalesced scope replay). */
  onSync: (r: Result) => void;
  onView: (v: ViewData) => void;
  onAnalysis: (r: AnalysisReply) => void;
}

export type WorkerIn = { cmd: Cmd } | { attach: MessagePort } | { analyze: AnalysisRequest };
export type WorkerOut = { result: Result } | { sync: Result } | { view: ViewData };

type Analyzer = (id: string, ctx: AnalysisContext, opts: Opts) => AnalysisResult | Promise<AnalysisResult>;

/** Synchronous in-process engine: tests, and browsers without module workers. */
export class InlineEngine implements Engine {
  core = new Core();
  private req: ViewReq = { mode: "ket", shots: 1024, shotSeed: 0 };
  onResult: (r: Result) => void = () => {};
  onSync: (r: Result) => void = () => {};
  onView: (v: ViewData) => void = () => {};
  onAnalysis: (r: AnalysisReply) => void = () => {};

  /** Pass `runAnalysis` (from analysis/run) to enable analyses. */
  constructor(public analyzer?: Analyzer) {}

  send(cmd: Cmd) {
    if (cmd.t === "view") this.req = cmd.req;
    this.onResult(this.core.handle(cmd));
    if (this.core.flush()) this.onSync(this.core.result());
    this.onView(this.core.view(this.req));
  }

  analyze(req: AnalysisRequest) {
    const snap = this.core.snapshot();
    const t0 = performance.now();
    const result = this.analyzer
      ? this.analyzer(req.id, { n: snap.n, state: snap.state, tape: snap.tape, scope: snap.scope }, req.opts)
      : { error: "analyses unavailable" };
    const reply = (r: AnalysisResult) => this.onAnalysis({ seq: req.seq, rev: snap.rev, id: req.id, result: r, ms: performance.now() - t0 });
    // Synchronous analyses reply at once (tests rely on it); async ones when done.
    if (result instanceof Promise) void result.then(reply);
    else reply(result);
  }

  cancelAnalysis() {}
}

export class WorkerEngine implements Engine {
  private worker: Worker;
  private analysisWorker!: Worker;
  onResult: (r: Result) => void = () => {};
  onSync: (r: Result) => void = () => {};
  onView: (v: ViewData) => void = () => {};
  onAnalysis: (r: AnalysisReply) => void = () => {};

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      if ("result" in e.data) this.onResult(e.data.result);
      else if ("sync" in e.data) this.onSync(e.data.sync);
      else this.onView(e.data.view);
    };
    this.startAnalysisWorker();
  }

  /** (Re)start the analysis worker and wire it to the core over a fresh channel. */
  private startAnalysisWorker() {
    const ch = new MessageChannel();
    this.analysisWorker = new Worker(new URL("../analysis/worker.ts", import.meta.url), { type: "module" });
    this.analysisWorker.onmessage = (e: MessageEvent<AnalysisReply>) => this.onAnalysis(e.data);
    this.analysisWorker.postMessage({ port: ch.port2 }, [ch.port2]);
    this.worker.postMessage({ attach: ch.port1 } satisfies WorkerIn, [ch.port1]);
  }

  send(cmd: Cmd) {
    this.worker.postMessage({ cmd } satisfies WorkerIn);
  }

  analyze(req: AnalysisRequest) {
    this.worker.postMessage({ analyze: req } satisfies WorkerIn);
  }

  cancelAnalysis() {
    this.analysisWorker.terminate();
    this.startAnalysisWorker();
  }
}

export function createEngine(): Engine {
  try {
    if (typeof Worker !== "undefined") return new WorkerEngine();
  } catch {
    /* module workers unsupported */
  }
  const eng = new InlineEngine();
  void import("../analysis/run").then((m) => (eng.analyzer = m.runAnalysis));
  return eng;
}
