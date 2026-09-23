/// <reference lib="webworker" />
import { Core, type ViewReq } from "./core";
import type { WorkerIn, WorkerOut } from "./engine";

const core = new Core();
let req: ViewReq = { mode: "ket", shots: 1024, shotSeed: 0 };
let scheduled = false;

const post = (m: WorkerOut) => (self as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const { cmd } = e.data;
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
