/**
 * Plot programs (LAB → Verification & export → Plot program): a short piece
 * of JavaScript, typed by the user, draws whatever it likes from the state.
 * Ported from Quantiom's plotProgram, keeping its safety model:
 *
 *  1. QC-1: the code runs in an opaque-origin data: worker started by
 *     plotHost.ts, whose server-sent CSP refuses every network request and
 *     nested worker; the runner verifies that isolation before it runs
 *     anything and refuses otherwise (docs/quantiom-bugs.md #55). Upstream
 *     only shadowed globals, which the prototype chain gives back.
 *  2. Network, storage and nested-worker globals are also removed.
 *  3. A timeout terminates a runaway program.
 *  4. The returned scene is sanitised: element types whitelisted, numbers
 *     clamped, colours limited to literals and the display's theme variables,
 *     path data to SVG path tokens, so nothing returned can inject markup,
 *     CSS or URLs.
 *
 * QC-1 changes: a bundled worker file instead of a blob: URL (the CSP allows
 * only same-origin workers); the input is QC-1's state, per-qubit ρ, symbol
 * values; colours use the display's validated series tokens.
 */
import type { AnalysisContext } from "./types";
import { reducedDensityMatrix } from "../sim/density";

export type PlotProgramInput = {
  n: number; dim: number;
  /** Indexed by basis state in Qiskit's order: qubit q is bit q of the index. */
  ampRe: number[]; ampIm: number[]; prob: number[];
  /** Per-qubit ρ, row-major re/im [ρ00, ρ01, ρ10, ρ11]. */
  rho1: { re: number[]; im: number[] }[];
  /** Symbol values (ASCII names: t, theta, …). */
  scope: Record<string, number>;
  steps: number;
  width: number; height: number;
  palette: { series1: string; series2: string; series3: string; ink: string; muted: string; grid: string };
};

export type PlotElement =
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number }
  | { type: "rect"; x: number; y: number; width: number; height: number; fill: string; stroke: string; opacity: number }
  | { type: "circle"; cx: number; cy: number; r: number; fill: string; stroke: string; opacity: number }
  | { type: "path"; d: string; stroke: string; fill: string; strokeWidth: number }
  | { type: "polyline"; points: [number, number][]; stroke: string; fill: string; strokeWidth: number }
  | { type: "text"; x: number; y: number; text: string; fill: string; anchor: "start" | "middle" | "end"; size: number };

export type PlotScene = { width: number; height: number; title?: string; elements: PlotElement[] };
export type PlotProgramResult = { scene: PlotScene } | { error: string };

export const PLOT_MAX_QUBITS = 14;
const W0 = 320, H0 = 180, MAX_ELEMENTS = 4000, MAX_POINTS = 4000, TIMEOUT_MS = 2500;

export function buildInput(ctx: AnalysisContext): PlotProgramInput {
  const n = ctx.n, dim = 1 << n;
  const ampRe = Array.from({ length: dim }, (_, i) => ctx.state[2 * i]);
  const ampIm = Array.from({ length: dim }, (_, i) => ctx.state[2 * i + 1]);
  return {
    n, dim, ampRe, ampIm, prob: ampRe.map((re, i) => re * re + ampIm[i] * ampIm[i]),
    rho1: Array.from({ length: n }, (_, q) => {
      const r = reducedDensityMatrix(ctx.state, n, [q]);
      return { re: [r[0][0].re, r[0][1].re, r[1][0].re, r[1][1].re], im: [r[0][0].im, r[0][1].im, r[1][0].im, r[1][1].im] };
    }),
    scope: { ...ctx.scope }, steps: ctx.tape.length, width: W0, height: H0,
    palette: { series1: "var(--series-1)", series2: "var(--series-2)", series3: "var(--series-3)", ink: "var(--ink)", muted: "var(--ink-muted)", grid: "var(--grid)" },
  };
}

const NAMED = new Set(["red", "green", "blue", "orange", "purple", "yellow", "cyan", "magenta", "white", "black", "gray", "grey", "teal", "pink", "lime", "navy", "gold", "transparent", "none"]);
const THEME = new Set(["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--ink)", "var(--ink-dim)", "var(--ink-muted)", "var(--grid)", "var(--lcd)"]);

/** Colours: hex, rgb(a), hsl(a), a few names, the display's theme variables; anything else falls back. */
export function sanitizeColor(c: unknown, fallback = "var(--series-1)"): string {
  if (typeof c !== "string") return fallback;
  const s = c.trim();
  if (s.length > 40) return fallback;
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  if (/^rgba?\(\s*[\d.\s,%]+\)$/.test(s) || /^hsla?\(\s*[\d.\s,%]+\)$/.test(s)) return s;
  if (THEME.has(s) || NAMED.has(s.toLowerCase())) return s;
  return fallback;
}

/** Path data: SVG path commands and numbers only. */
export function sanitizePathD(d: unknown): string | null {
  if (typeof d !== "string" || d.length > 20000) return null;
  return /^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\s+-]*$/.test(d) ? d : null;
}

const num = (v: unknown, fallback: number, lo = -1e6, hi = 1e6) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
};
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

function sanitizeElement(raw: unknown): PlotElement | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const opt = (c: unknown) => (c != null ? sanitizeColor(c, "none") : "none");
  switch (e.type) {
    case "line": return { type: "line", x1: num(e.x1, 0), y1: num(e.y1, 0), x2: num(e.x2, 0), y2: num(e.y2, 0), stroke: sanitizeColor(e.stroke), strokeWidth: num(e.strokeWidth, 1, 0, 20) };
    case "rect": return { type: "rect", x: num(e.x, 0), y: num(e.y, 0), width: num(e.width, 0, 0), height: num(e.height, 0, 0), fill: sanitizeColor(e.fill), stroke: opt(e.stroke), opacity: num(e.opacity, 1, 0, 1) };
    case "circle": return { type: "circle", cx: num(e.cx, 0), cy: num(e.cy, 0), r: num(e.r, 1, 0, 1e4), fill: sanitizeColor(e.fill), stroke: opt(e.stroke), opacity: num(e.opacity, 1, 0, 1) };
    case "path": {
      const d = sanitizePathD(e.d);
      return d === null ? null : { type: "path", d, stroke: sanitizeColor(e.stroke), fill: opt(e.fill), strokeWidth: num(e.strokeWidth, 1, 0, 20) };
    }
    case "polyline": {
      if (!Array.isArray(e.points)) return null;
      const points = e.points.slice(0, MAX_POINTS).map((p) => { const a = Array.isArray(p) ? p : []; return [num(a[0], 0), num(a[1], 0)] as [number, number]; });
      return { type: "polyline", points, stroke: sanitizeColor(e.stroke), fill: opt(e.fill), strokeWidth: num(e.strokeWidth, 1, 0, 20) };
    }
    case "text": {
      const anchor = e.anchor === "middle" || e.anchor === "end" ? e.anchor : "start";
      return { type: "text", x: num(e.x, 0), y: num(e.y, 0), text: str(e.text), fill: sanitizeColor(e.fill, "var(--ink-muted)"), anchor, size: num(e.size, 9, 1, 64) };
    }
    default: return null;
  }
}

export function sanitizePlotScene(raw: unknown): PlotProgramResult {
  if (!raw || typeof raw !== "object") return { error: "the program did not return an object" };
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.elements)) return { error: "the scene has no `elements` array" };
  const elements = s.elements.slice(0, MAX_ELEMENTS).map(sanitizeElement).filter((x): x is PlotElement => x !== null);
  if (!elements.length) return { error: "the scene has no drawable elements" };
  return { scene: { width: num(s.width, W0, 50, 2000), height: num(s.height, H0, 50, 2000), title: s.title != null ? str(s.title, 120) : undefined, elements } };
}

/** Run a program in the sandbox. Never rejects: { scene } or { error }. */
export function runPlotProgram(code: string, input: PlotProgramInput, timeoutMs = TIMEOUT_MS): Promise<PlotProgramResult> {
  return new Promise((resolve) => {
    if (typeof Worker === "undefined") return resolve({ error: "Web Workers are unavailable here: the plot sandbox can't run." });
    let worker: Worker;
    try {
      worker = new Worker(new URL("./plotHost.ts", import.meta.url), { type: "module" });
    } catch {
      return resolve({ error: "could not start the plot sandbox" });
    }
    let done = false;
    const finish = (r: PlotProgramResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ error: `the program ran over ${timeoutMs} ms (an endless loop?)` }), timeoutMs);
    worker.onmessage = (ev: MessageEvent<{ ok: boolean; scene?: unknown; error?: string }>) =>
      finish(ev.data.ok ? sanitizePlotScene(ev.data.scene) : { error: ev.data.error ?? "the program threw" });
    worker.onerror = (e) => finish({ error: e.message || "the program crashed" });
    worker.postMessage({ code, data: input });
  });
}

/** Example programs (the presets). */
export const PLOT_PRESETS: { label: string; code: string }[] = [
  { label: "bars", code: `// Probabilities as bars. data: n, dim, ampRe, ampIm, prob, rho1, scope, width, height, palette
const W = data.width, H = data.height, w = W / data.dim, out = [];
data.prob.forEach((p, i) => out.push({ type: "rect", x: i * w + 1, y: H - p * H, width: Math.max(1, w - 2), height: p * H, fill: data.palette.series1 }));
return { width: W, height: H, elements: out };` },
  { label: "phases", code: `// Each amplitude as a line from the centre: length |a|, angle arg(a).
const W = data.width, H = data.height, cx = W / 2, cy = H / 2, R = H / 2 - 8, out = [];
out.push({ type: "circle", cx, cy, r: R, fill: "none", stroke: data.palette.grid });
data.ampRe.forEach((re, i) => { const im = data.ampIm[i], m = Math.hypot(re, im); if (m < 1e-6) return;
  out.push({ type: "line", x1: cx, y1: cy, x2: cx + R * re, y2: cy - R * im, stroke: data.palette.series1, strokeWidth: 2 });
  out.push({ type: "text", x: cx + (R + 4) * re / m, y: cy - (R + 4) * im / m, text: i.toString(2).padStart(data.n, "0"), fill: data.palette.muted, anchor: "middle", size: 8 }); });
return { width: W, height: H, elements: out };` },
  { label: "Z per qubit", code: `// ⟨Zq⟩ = ρ00 − ρ11 for each qubit, as a line.
const W = data.width, H = data.height, pts = data.rho1.map((r, q) => [20 + q * (W - 40) / Math.max(1, data.n - 1), H / 2 - (r.re[0] - r.re[3]) * (H / 2 - 10)]);
const out = [{ type: "line", x1: 10, y1: H / 2, x2: W - 10, y2: H / 2, stroke: data.palette.grid }];
out.push({ type: "polyline", points: pts, stroke: data.palette.series2, strokeWidth: 2 });
pts.forEach(([x, y], q) => out.push({ type: "circle", cx: x, cy: y, r: 3, fill: data.palette.series2 }, { type: "text", x, y: H - 4, text: "q" + q, anchor: "middle", size: 8 }));
return { width: W, height: H, elements: out };` },
];
