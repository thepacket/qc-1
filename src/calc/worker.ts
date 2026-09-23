/// <reference lib="webworker" />
import { Core, type ViewReq } from "./core";
import type { WorkerIn, WorkerOut } from "./engine";

const core = new Core();
let req: ViewReq = { mode: "ket", shots: 1024, shotSeed: 0 };
let scheduled = false;
/** Channel to the analysis worker (re-attached whenever it is restarted). */
let analysis: MessagePort | null = null;

const post = (m: WorkerOut) => (self as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if ("attach" in msg) {
    analysis = msg.attach;
    return;
  }
  if ("analyze" in msg) {
    // Hand the analysis worker its own copy of the register, so a slow
    // analysis never holds up key presses here.
    const snap = core.snapshot();
    analysis?.postMessage({ req: msg.analyze, snap }, [snap.state.buffer]);
    return;
  }
  const { cmd } = msg;
  if (cmd.t === "view") req = cmd.req;
  post({ result: core.handle(cmd) });
  // Compute the view once the queued burst of commands has drained.
  if (!scheduled) {
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      post({ view: core.view(req) });
    }, 0);
  }
};
