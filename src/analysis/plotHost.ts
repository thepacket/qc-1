/// <reference lib="webworker" />
/**
 * The plot-program sandbox host (plotProgram.ts). The user's code never runs
 * here: this worker starts a *data:* URL worker for it, and relays one run.
 *
 * Isolation comes from the browser, not from deleting globals:
 *  - a data: worker has an opaque origin, so origin storage (CacheStorage,
 *    IndexedDB, cookies) is out of reach, including the app's own caches;
 *  - it inherits this worker's Content-Security-Policy, which the server sends
 *    with this script only: `default-src 'none'; script-src 'unsafe-eval';
 *    worker-src data:` (deploy/plot-host-headers.conf; the preview server sends
 *    the same, dev adds 'self' for its injected imports; vite.config.ts), so
 *    fetch, XHR, WebSocket, EventSource, beacons, script loads (import()) and
 *    nested workers other than data: are refused.
 * The runner checks both before it runs anything (fail closed): an opaque
 * origin, no storage, and a probe request that the CSP must refuse. A browser
 * that can't give that isolation gets an error, not an unsandboxed run.
 * Removing the network/storage globals stays as a second layer, as do the
 * caller's timeout and scene sanitiser.
 */

/** Runs inside the data: worker. Self-contained: serialised with toString(). */
function runner() {
  const post = (m: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);
  self.onmessage = async (ev: MessageEvent<{ code: string; data: unknown; probe: string }>) => {
    const g = self as unknown as Record<string, unknown>;
    // 1. Verify the isolation the browser should provide.
    if (g.origin !== "null") return post({ ok: false, error: "the plot sandbox isn't isolated here (the worker's origin isn't opaque)", isolation: true });
    try {
      const c = g.caches as { keys(): Promise<unknown> } | undefined;
      if (c) { await c.keys(); return post({ ok: false, error: "the plot sandbox isn't isolated here (origin storage is reachable)", isolation: true }); }
    } catch { /* refused: good */ }
    try {
      const f = g.fetch as ((u: string) => Promise<unknown>) | undefined;
      // A same-origin http request, the kind the CSP must refuse (without it: one harmless 404).
      if (f) { await f(ev.data.probe); return post({ ok: false, error: "the plot sandbox isn't isolated here (network requests aren't blocked)", isolation: true }); }
    } catch { /* refused by the CSP: good */ }
    // 2. Defence in depth: remove the capabilities from the global and every prototype on its chain.
    const KILL = ["fetch", "XMLHttpRequest", "WebSocket", "WebSocketStream", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel",
      "Worker", "SharedWorker", "navigator", "WebTransport", "Request", "Response", "cookieStore", "storage"];
    // (Not Object.prototype: that would give every object a read-only `fetch`, `storage`, ….)
    for (let o: object | null = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (const k of KILL) {
        try { if (Object.prototype.hasOwnProperty.call(o, k)) delete (o as Record<string, unknown>)[k]; } catch { /* non-configurable */ }
        try { Object.defineProperty(o, k, { value: undefined, configurable: false, writable: false }); } catch { /* ignore */ }
      }
    }
    // 3. Run.
    try {
      const fn = new Function("data", `"use strict";\n${ev.data.code}`) as (data: unknown) => unknown;
      post({ ok: true, scene: fn(ev.data.data) });
    } catch (err) {
      post({ ok: false, error: String(err instanceof Error ? err.message : err) });
    }
  };
}

const RUNNER_URL = `data:text/javascript;charset=utf-8,${encodeURIComponent(`(${runner.toString()})();`)}`;

self.onmessage = (ev: MessageEvent<{ code: string; data: unknown }>) => {
  const reply = (m: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
  let inner: Worker;
  try {
    inner = new Worker(RUNNER_URL);
  } catch (err) {
    return reply({ ok: false, error: `this browser can't start an isolated plot worker (${String(err instanceof Error ? err.message : err)})`, isolation: true });
  }
  inner.onmessage = (m) => { reply(m.data); inner.terminate(); };
  inner.onerror = (e) => { e.preventDefault(); reply({ ok: false, error: e.message || "the program crashed" }); inner.terminate(); };
  inner.postMessage({ ...ev.data, probe: new URL("/__plot-sandbox-probe", self.location.href).href });
};
