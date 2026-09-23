import { describe, test, expect } from "vitest";
import { executeTool, runAgent, SYSTEM_PROMPT, type AgentEnv, type ChatItem } from "../src/ai/agent";
import type { AgentMessage } from "../src/ai/openrouter";
import { importQasm } from "../src/qasm/import";

const bell: AgentEnv = { ...(() => { const r = importQasm(`OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; h q[0]; cx q[0], q[1];`); return { n: r.n, tape: r.tape }; })(), scope: {}, noise: null, gates: [] };

/** A fake OpenRouter: replies in order; records what it was sent. */
function fakeFetch(replies: unknown[]) {
  const sent: { url: string; body: { model: string; messages: AgentMessage[]; tools?: unknown[] }; auth: string }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization });
    const reply = replies.shift();
    return new Response(JSON.stringify({ choices: [{ message: reply }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, sent };
}

describe("agent tools", () => {
  test("get_state: the tape as QASM and the largest amplitudes (q0 is the leftmost bit)", async () => {
    const out = JSON.parse((await executeTool("get_state", "{}", bell)).result);
    expect(out.n).toBe(2);
    expect(out.qasm).toContain("cx q[0], q[1];");
    expect(out.largestAmplitudes.map((a: { ket: string }) => a.ket).sort()).toEqual(["00", "11"]);
  });

  test("run_analysis returns the numbers; an unknown id or bad JSON comes back as an error the model can read", async () => {
    const r = JSON.parse((await executeTool("run_analysis", JSON.stringify({ id: "concurrence" }), bell)).result);
    expect(r.error).toBeUndefined();
    expect(JSON.stringify(r.charts)).toMatch(/1/);
    expect((await executeTool("run_analysis", `{"id":"nope"}`, bell)).result).toMatch(/no analysis "nope"/);
    expect((await executeTool("run_analysis", `{oops`, bell)).result).toMatch(/not JSON/);
  });

  test("propose_tape never changes anything: it returns a proposal to show, checked by the importer", async () => {
    const good = await executeTool("propose_tape", JSON.stringify({ title: "GHZ", qasm: `OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; h q[0]; cx q[0], q[1]; cx q[1], q[2];` }), bell);
    expect(good.show).toMatchObject({ kind: "proposal", proposal: { title: "GHZ", n: 3, steps: 3 } });
    const bad = await executeTool("propose_tape", JSON.stringify({ title: "x", qasm: "qubit[2] q; frobnicate q[0];" }), bell);
    expect(bad.result).toMatch(/^error:/);
    expect(bad.show.kind).toBe("tool");
  });

  test("a circuit tool's verified rewrite becomes a proposal too", async () => {
    const env = { ...bell, ...(() => { const r = importQasm(`OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; h q[0]; h q[0]; x q[0];`); return { n: r.n, tape: r.tape }; })() };
    const out = await executeTool("run_analysis", JSON.stringify({ id: "simplify" }), env);
    expect(out.show.kind).toBe("proposal");
  });
});

describe("agent loop", () => {
  test("runs the tools the model asks for, feeds back the results, ends on a text answer; the key only goes in the header", async () => {
    const { f, sent } = fakeFetch([
      { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "get_state", arguments: "{}" } }] },
      { content: "It's a Bell pair.", tool_calls: [] },
    ]);
    const items: ChatItem[] = [];
    const messages = await runAgent({
      apiKey: "sk-test-123", model: "some/model", env: () => bell, onItem: (i) => items.push(i), doFetch: f,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "what state is this?" }],
    });
    expect(items).toEqual([{ kind: "tool", text: "read the register (n = 2, 2 steps)" }, { kind: "assistant", text: "It's a Bell pair." }]);
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(sent).toHaveLength(2);
    expect(sent[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(sent[0].auth).toBe("Bearer sk-test-123");
    expect(JSON.stringify(sent.map((s) => s.body))).not.toContain("sk-test-123");
    expect(sent[1].body.messages[3]).toMatchObject({ role: "tool", tool_call_id: "c1" });
  });

  test("stops after maxSteps rounds of tool calls", async () => {
    const call = { content: "", tool_calls: [{ id: "c", type: "function", function: { name: "list_analyses", arguments: "{}" } }] };
    const { f } = fakeFetch([call, call, call]);
    const items: ChatItem[] = [];
    await runAgent({ apiKey: "k", model: "m", env: () => bell, onItem: (i) => items.push(i), doFetch: f, maxSteps: 2, messages: [] });
    expect(items.at(-1)).toEqual({ kind: "error", text: "stopped after too many tool rounds" });
  });
});
