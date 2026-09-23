import { useEffect, useRef, useState } from "react";
import type { Calculator } from "../calc/calculator";
import { runAgent, SYSTEM_PROMPT, type AgentEnv, type ChatItem } from "../ai/agent";
import { listModels, type AgentMessage, type Model } from "../ai/openrouter";

/**
 * The AI chat (the "AI" button): the user's own OpenRouter key and model,
 * kept in this device's storage only. The conversation lives for the session
 * (module state, so closing the screen keeps it).
 */
const KEY = "qc1:openrouter:key";
const MODEL = "qc1:openrouter:model";
const get = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };
const put = (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* storage blocked */ } };

const session: { items: ChatItem[]; messages: AgentMessage[] } = { items: [], messages: [{ role: "system", content: SYSTEM_PROMPT }] };

export function ChatView({ calc }: { calc: Calculator }) {
  const [key, setKey] = useState(() => get(KEY));
  const [model, setModel] = useState(() => get(MODEL));
  const [settings, setSettings] = useState(() => !get(KEY) || !get(MODEL));
  const [items, setItems] = useState<ChatItem[]>(session.items);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [items, busy]);

  const push = (i: ChatItem) => { session.items = [...session.items, i]; setItems(session.items); };
  const env = (): AgentEnv => ({ n: calc.n, tape: calc.tape, scope: calc.scope, noise: calc.noiseOn ? calc.noise : null, gates: calc.customGates });

  const send = async () => {
    const q = text.trim();
    if (!q || busy) return;
    setText("");
    push({ kind: "user", text: q });
    setBusy(true);
    abort.current = new AbortController();
    try {
      session.messages = await runAgent({
        apiKey: key, model, env, onItem: push, signal: abort.current.signal,
        messages: [...session.messages, { role: "user", content: q }],
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) push({ kind: "error", text: e instanceof Error ? e.message : String(e) });
      session.messages = [...session.messages, { role: "user", content: q }];
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const apply = (i: number) => {
    const it = session.items[i];
    if (it.kind !== "proposal") return;
    try {
      calc.loadQasm(it.proposal.qasm, it.proposal.title);
      session.items = session.items.map((x, k) => (k === i ? { ...it, applied: true } : x));
      setItems(session.items);
    } catch (e) {
      push({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  if (settings) return <ChatSettings apiKey={key} model={model} done={(k, m) => { setKey(k); setModel(m); put(KEY, k); put(MODEL, m); setSettings(!k || !m); }} close={() => calc.toggleChat()} />;

  return (
    <div className="view">
      <div className="view-head lab-head">
        <button className="back" onClick={() => calc.toggleChat()} aria-label="Close the chat">‹</button>
        <span>AI chat</span>
        <span className="grow" />
        <button className="lab-status" onClick={() => { session.items = []; session.messages = [{ role: "system", content: SYSTEM_PROMPT }]; setItems([]); }} disabled={busy}>clear</button>
        <button className="lab-status" onClick={() => setSettings(true)} aria-label="Chat settings">⚙</button>
      </div>
      <div className="rows chat-log" aria-live="polite">
        {items.length === 0 && (
          <p className="dim note">Ask about the state, or for a circuit: “is this entangled?”, “make a 4-qubit GHZ state”, “why does Grover need 2 iterations here?”. The model reads the circuit and runs LAB analyses; a circuit it suggests comes with Apply (UNDO takes it back).</p>
        )}
        {items.map((it, i) => <Item key={i} it={it} apply={() => apply(i)} />)}
        {busy && <div className="chat-tool busy">thinking…</div>}
        <div ref={end} />
      </div>
      <div className="chat-input">
        <textarea value={text} rows={2} placeholder="Ask…" aria-label="Message" spellCheck
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        {busy
          ? <button className="qb" onClick={() => abort.current?.abort()}>stop</button>
          : <button className="qb sel" onClick={() => void send()} disabled={!text.trim()}>send</button>}
      </div>
    </div>
  );
}

/** Text with ``` fences shown as code; everything as text, never as HTML. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/```[a-zA-Z0-9]*\n?/);
  return <>{parts.map((p, i) => (i % 2 ? <pre key={i} className="chat-code">{p.replace(/\n$/, "")}</pre> : <span key={i}>{p}</span>))}</>;
}

function Item({ it, apply }: { it: ChatItem; apply: () => void }) {
  if (it.kind === "user") return <div className="chat-msg user">{it.text}</div>;
  if (it.kind === "assistant") return <div className="chat-msg ai"><Rich text={it.text} /></div>;
  if (it.kind === "tool") return <div className="chat-tool">· {it.text}</div>;
  if (it.kind === "error") return <div className="lab-error">E: {it.text}</div>;
  const p = it.proposal;
  return (
    <div className="proposal chat-proposal">
      <span><b>{p.title}</b> · {p.n} qubit{p.n > 1 ? "s" : ""}, {p.steps} step{p.steps === 1 ? "" : "s"}{p.note ? ` · ${p.note}` : ""}</span>
      <details><summary>OpenQASM</summary><pre className="chat-code">{p.qasm}</pre></details>
      {it.applied ? <span className="dim">applied (UNDO restores the previous circuit)</span> : <button className="lab-status apply" onClick={apply}>APPLY · replace the circuit</button>}
    </div>
  );
}

function ChatSettings({ apiKey, model, done, close }: { apiKey: string; model: string; done: (key: string, model: string) => void; close: () => void }) {
  const [k, setK] = useState(apiKey);
  const [m, setM] = useState(model);
  const [filter, setFilter] = useState("claude");
  const [models, setModels] = useState<Model[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    listModels().then((ms) => live && setModels(ms)).catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, []);
  const shown = (models ?? []).filter((x) => `${x.id} ${x.name}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 40);
  return (
    <div className="view">
      <div className="view-head lab-head">
        <button className="back" onClick={close} aria-label="Close the chat">‹</button>
        <span>AI chat · settings</span>
      </div>
      <div className="rows lab-body typed">
        <label className="dim" htmlFor="or-key">OpenRouter API key</label>
        <input id="or-key" className="int-field chat-key" type="password" value={k} autoComplete="off" spellCheck={false}
          placeholder="sk-or-…" onChange={(e) => setK(e.target.value.trim())} onKeyDown={(e) => e.stopPropagation()} />
        <p className="dim note">Your key stays on this device (its storage) and is sent only to openrouter.ai, which bills your account. The chat sends the model the circuit (as OpenQASM), the state's largest amplitudes, symbol values and the results of the analyses it runs; nothing else leaves the calculator. Create a key at openrouter.ai; forget it here with the button below.</p>
        <label className="dim" htmlFor="or-filter">Model {m && <b>· {m}</b>}</label>
        <input id="or-filter" className="int-field chat-key" value={filter} placeholder="search models" onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        {err && <div className="lab-error">E: {err}</div>}
        {!models && !err && <p className="dim">loading the model list…</p>}
        <div className="chat-models">
          {shown.map((x) => (
            <button key={x.id} className={`cat-row${x.id === m ? " on" : ""}`} onClick={() => setM(x.id)}>
              <span>{x.name}</span>
            </button>
          ))}
        </div>
        <div className="cut-picker">
          <button className="qb sel" disabled={!k || !m} onClick={() => done(k, m)}>save</button>
          <button className="qb" onClick={() => { setK(""); done("", m); }}>forget the key</button>
        </div>
      </div>
    </div>
  );
}
