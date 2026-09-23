/**
 * The AI chat's agent: a system prompt, four tools, and the loop that runs
 * them. The model can read (the tape, the state, LAB analyses) but not write:
 * a tape it wants goes to the user as a proposal, applied only when they tap
 * Apply (an undoable replace, like RCL). LAB circuit tools that return a
 * verified rewrite surface the same way.
 *
 * What the model sees: the register size, the tape as OpenQASM 3, symbol
 * values, whether noise is on, the largest amplitudes (n ≤ 14), and the
 * results of the analyses it runs. The API key never enters a message.
 */
import type { AgentMessage, Fetch, ToolDef } from "./openrouter";
import { chatCompletion } from "./openrouter";
import type { Entry, Scope } from "../calc/steps";
import type { CustomGate } from "../calc/custom";
import { setCustomGates } from "../calc/custom";
import type { NoiseModel } from "../noise/model";
import type { AnalysisResult, Chart } from "../analysis/types";
import { ANALYSES, ANALYSIS_BY_ID } from "../analysis/catalog";
import { exportQasm3 } from "../qasm/fromTape";
import { importQasm } from "../qasm/import";
import { Register } from "../calc/register";

/** A snapshot of the calculator for a tool call. */
export type AgentEnv = { n: number; tape: Entry[]; scope: Scope; noise: NoiseModel | null; gates: CustomGate[] };

export type Proposal = { title: string; qasm: string; n: number; steps: number; note?: string };

/** What the chat screen shows. */
export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "proposal"; proposal: Proposal; applied?: boolean }
  | { kind: "error"; text: string };

export const STATE_MAX = 14;

export const SYSTEM_PROMPT = `You are the assistant inside QC-1, a pocket quantum calculator on a phone. Be brief: a phone screen, short paragraphs, no tables wider than the screen.

Conventions: qubits are q0…q(n−1); q0 is the MOST significant (leftmost) bit of a ket |q0 q1 …⟩ (Qiskit prints the opposite way). Angles in radians; RX(θ) = e^{−iθX/2} as in Qiskit. Up to 20 qubits run on a statevector; up to 1024 on a stabilizer tableau (Clifford gates only). Symbols (t, theta, …) are angles the user can slide; t can be played over one period.

Tools: get_state reads the register and tape (OpenQASM 3). list_analyses names the LAB analyses and their options; run_analysis runs one on the current state and returns its numbers. propose_tape offers the user a new tape (OpenQASM 3, stdgates.inc; declare symbols with "input float theta;"); the user applies it with a tap, so explain in a sentence what it does. Never claim to have changed the calculator: you can only propose. Prefer running an analysis to guessing a number.`;

const t = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

export const TOOLS: ToolDef[] = [
  t("get_state", "The register: qubit count, the tape as OpenQASM 3, symbol values, noise on/off, and (n ≤ 14) the largest amplitudes.", {}),
  t("list_analyses", "The LAB analyses: id, title, category, options (name, kind, allowed values). Optionally filtered by a word.", { filter: { type: "string" } }),
  t("run_analysis", "Run a LAB analysis on the current state (n ≤ 14 here) and return its numbers and notes. Options by name, as list_analyses shows.", {
    id: { type: "string" }, options: { type: "object", description: "option name → value", additionalProperties: true },
  }, ["id"]),
  t("propose_tape", "Offer the user a new tape. It is checked by QC-1's importer and shown with an Apply button; nothing changes until they tap it.", {
    title: { type: "string", description: "a short name, e.g. 'GHZ on 4 qubits'" },
    qasm: { type: "string", description: "OpenQASM 3 with include \"stdgates.inc\"" },
  }, ["title", "qasm"]),
];

const r6 = (x: number) => +x.toPrecision(6);

function stateOf(env: AgentEnv): Float64Array | null {
  if (env.n > STATE_MAX) return null;
  setCustomGates(env.gates);
  return new Register(env.n, env.tape, env.scope).state;
}

/** A chart as compact JSON the model can read (large grids and series cut down). */
function chartSummary(c: Chart): unknown {
  switch (c.kind) {
    case "heatmap": return { kind: c.kind, title: c.title, rows: c.rows.slice(0, 16), cols: c.cols.slice(0, 16), values: c.values.slice(0, 16).map((r) => r.slice(0, 16).map(r6)) };
    case "bars": return { kind: c.kind, title: c.title, bars: c.labels.slice(0, 32).map((l, i) => [l, r6(c.values[i])]) };
    case "lines": {
      const step = Math.max(1, Math.ceil(c.x.length / 40));
      const idx = c.x.map((_, i) => i).filter((i) => i % step === 0);
      return { kind: c.kind, title: c.title, xLabel: c.xLabel, yLabel: c.yLabel, x: idx.map((i) => r6(c.x[i])), series: c.series.map((s) => ({ name: s.name, y: idx.map((i) => r6(s.y[i])) })) };
    }
    case "table": return { kind: c.kind, title: c.title, headers: c.headers, rows: c.rows.slice(0, 24) };
    default: return { kind: c.kind, title: "title" in c ? c.title : undefined };
  }
}

export type ToolOutcome = { result: string; show: ChatItem };

/** Run one tool call against a snapshot. Never throws: errors go back to the model as text. */
export async function executeTool(name: string, rawArgs: string, env: AgentEnv): Promise<ToolOutcome> {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(rawArgs || "{}"); } catch { return { result: "error: the arguments are not JSON", show: { kind: "tool", text: `${name}: bad arguments` } }; }
  try {
    switch (name) {
      case "get_state": {
        const st = stateOf(env);
        const amps = st ? [...Array(1 << env.n).keys()]
          .map((i) => ({ i, re: st[2 * i], im: st[2 * i + 1] }))
          .filter((a) => a.re * a.re + a.im * a.im > 1e-10)
          .sort((a, b) => b.re * b.re + b.im * b.im - (a.re * a.re + a.im * a.im))
          .slice(0, 16)
          .map((a) => ({ ket: a.i.toString(2).padStart(env.n, "0"), re: r6(a.re), im: r6(a.im), p: r6(a.re * a.re + a.im * a.im) })) : null;
        const out = { n: env.n, steps: env.tape.length, qasm: exportQasm3(env.n, env.tape), symbols: env.scope, noise: !!env.noise?.enabled, largestAmplitudes: amps ?? `not computed above ${STATE_MAX} qubits` };
        return { result: JSON.stringify(out), show: { kind: "tool", text: `read the register (n = ${env.n}, ${env.tape.length} steps)` } };
      }
      case "list_analyses": {
        const f = typeof args.filter === "string" ? args.filter.toLowerCase() : "";
        const list = ANALYSES.filter((a) => !f || `${a.id} ${a.title} ${a.category} ${a.summary}`.toLowerCase().includes(f)).map((a) => ({
          id: a.id, title: a.title, category: a.category, maxQubits: a.maxQubits,
          options: a.inputs.map((s) => ({ name: s.key, kind: s.kind, ...("options" in s ? { values: s.options.map((o) => o.value) } : {}), ...("min" in s ? { min: s.min, max: s.max } : {}) })),
        }));
        return { result: JSON.stringify(list), show: { kind: "tool", text: `looked up analyses${f ? ` (“${f}”)` : ""}` } };
      }
      case "run_analysis": {
        const id = String(args.id ?? "");
        const meta = ANALYSIS_BY_ID[id];
        if (!meta) return { result: `error: no analysis "${id}" (see list_analyses)`, show: { kind: "tool", text: `no analysis ${id}` } };
        const st = stateOf(env);
        if (!st) return { result: `error: the chat runs analyses up to ${STATE_MAX} qubits`, show: { kind: "tool", text: `${meta.title}: too many qubits` } };
        const { runAnalysis } = await import("../analysis/run");
        const res: AnalysisResult = await runAnalysis(id, { n: env.n, state: st, tape: env.tape, scope: env.scope, noise: env.noise ?? undefined }, (args.options as Record<string, unknown>) ?? {});
        const summary = { error: res.error, scalars: res.scalars, charts: res.charts?.map(chartSummary), notes: res.notes, proposal: res.proposal ? { verified: res.proposal.verified, check: res.proposal.check } : undefined };
        if (res.proposal?.verified) {
          const p = res.proposal;
          return {
            result: `${JSON.stringify(summary)}\n(The verified rewrite was shown to the user with an Apply button.)`,
            show: { kind: "proposal", proposal: { title: `${meta.title}: ${p.label.replace(/^APPLY · /, "")}`, qasm: exportQasm3(p.n, p.tape), n: p.n, steps: p.tape.length, note: p.check } },
          };
        }
        return { result: JSON.stringify(summary), show: { kind: "tool", text: `ran ${meta.title}${res.error ? ` (error: ${res.error})` : ""}` } };
      }
      case "propose_tape": {
        const qasm = String(args.qasm ?? ""), title = String(args.title ?? "proposal").slice(0, 80);
        const r = importQasm(qasm, env.gates);
        return {
          result: `shown to the user with an Apply button: ${r.n} qubits, ${r.tape.length} steps${r.notes.length ? `; importer notes: ${r.notes.join("; ")}` : ""}`,
          show: { kind: "proposal", proposal: { title, qasm, n: r.n, steps: r.tape.length, note: r.notes[0] } },
        };
      }
      default:
        return { result: `error: unknown tool ${name}`, show: { kind: "tool", text: `unknown tool ${name}` } };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { result: `error: ${msg}`, show: { kind: "tool", text: `${name} failed: ${msg}` } };
  }
}

/**
 * One user turn: call the model, run the tools it asks for, feed back the
 * results, until it answers in text (or `maxSteps` rounds). Returns the
 * conversation with this turn added; `onItem` receives what to show.
 */
export async function runAgent(p: {
  apiKey: string; model: string; messages: AgentMessage[]; env: () => AgentEnv;
  onItem: (item: ChatItem) => void; signal?: AbortSignal; maxSteps?: number; doFetch?: Fetch;
}): Promise<AgentMessage[]> {
  const messages = [...p.messages];
  for (let step = 0; step < (p.maxSteps ?? 8); step++) {
    const r = await chatCompletion(p.apiKey, p.model, messages, TOOLS, p.signal, undefined, p.doFetch);
    messages.push({
      role: "assistant", content: r.content || null,
      ...(r.toolCalls.length ? { tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })) } : {}),
    });
    if (r.content.trim()) p.onItem({ kind: "assistant", text: r.content.trim() });
    if (!r.toolCalls.length) return messages;
    for (const c of r.toolCalls) {
      const out = await executeTool(c.name, c.arguments, p.env());
      p.onItem(out.show);
      messages.push({ role: "tool", tool_call_id: c.id, name: c.name, content: out.result });
    }
  }
  p.onItem({ kind: "error", text: "stopped after too many tool rounds" });
  return messages;
}
