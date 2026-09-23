/// <reference lib="webworker" />
/**
 * The plot-program sandbox (plotProgram.ts): a worker of its own, one per
 * run, terminated after. Network, storage and nested-execution globals are
 * removed before the user's code runs; the code gets `data` and returns a
 * scene, which the caller sanitises.
 */
const KILL = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker", "navigator", "WebTransport"];

self.onmessage = (ev: MessageEvent<{ code: string; data: unknown }>) => {
  const scope = self as unknown as Record<string, unknown>;
  for (const k of KILL) {
    try {
      Object.defineProperty(scope, k, { value: undefined, configurable: false, writable: false });
    } catch {
      try { scope[k] = undefined; } catch { /* not writable */ }
    }
  }
  const reply = (self as unknown as DedicatedWorkerGlobalScope).postMessage.bind(self);
  try {
    const fn = new Function("data", `"use strict";\n${ev.data.code}`) as (data: unknown) => unknown;
    reply({ ok: true, scene: fn(ev.data.data) });
  } catch (err) {
    reply({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
};
