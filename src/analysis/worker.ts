/// <reference lib="webworker" />
import { runAnalysis } from "./run";
import type { AnalysisReply, AnalysisRequest } from "./types";
import type { Entry } from "../calc/steps";

type Job = { req: AnalysisRequest; snap: { rev: number; n: number; tape: Entry[]; state: Float64Array } };

/**
 * The analysis worker: receives register snapshots from the core worker over
 * a MessagePort and replies to the UI thread. It can be terminated at any
 * time (cancel / stale work) without touching the register.
 */
self.onmessage = (e: MessageEvent<{ port: MessagePort }>) => {
  e.data.port.onmessage = (m: MessageEvent<Job>) => {
    const { req, snap } = m.data;
    const t0 = performance.now();
    const result = runAnalysis(req.id, { n: snap.n, state: snap.state, tape: snap.tape }, req.opts);
    const reply: AnalysisReply = { seq: req.seq, rev: snap.rev, id: req.id, result, ms: performance.now() - t0 };
    (self as DedicatedWorkerGlobalScope).postMessage(reply);
  };
};
