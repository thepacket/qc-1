import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Calculator, type Mode, type Saved } from "../calc/calculator";
import { formatEntry } from "../calc/steps";
import { BlochView, KetView, Pending, ProbView, ShotsView, TapeView } from "./views";
import { createEngine } from "../calc/engine";
import { LabView } from "./lab/LabView";
import { ParamView } from "./ParamView";
import { symbolGlyph } from "../calc/entry";
import { STAB_MAX } from "../stab/register";
import { readShareHash } from "../qasm/share";
import { HelpView } from "./HelpView";
import { ReportView } from "./ReportView";
import { ChatView } from "./ChatView";
import { Palette, PlacingSheet } from "./Palette";
import { setTrash, useDrag } from "./dnd";

export const STORAGE_KEY = "qc1:session:v1";

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

const MODES: { id: Mode; label: string }[] = [
  { id: "tape", label: "CIRCUIT" },
  { id: "ket", label: "STATE" },
  { id: "prob", label: "PROB" },
  { id: "bloch", label: "BLOCH" },
  { id: "shots", label: "SHOTS" },
  { id: "lab", label: "LAB" },
];

/** A phone on its side: the display on the left, the palette (Circuit tab) on the right. */
const LANDSCAPE = "(orientation: landscape) and (max-height: 540px)";

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(query);
    const f = () => setOn(m.matches);
    m.addEventListener("change", f);
    f();
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

/** The qubit count: − n +, or tap the number and type it. */
function QubitCount({ calc }: { calc: Calculator }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== "") calc.setQubitCount(Number(draft));
    setDraft(null);
  };
  return (
    <span className="qcount" role="group" aria-label="Number of qubits">
      <button onClick={() => calc.setQubitCount(calc.n - 1)} disabled={calc.n <= 1} aria-label="One qubit fewer">−</button>
      <input type="number" inputMode="numeric" min={1} max={STAB_MAX} aria-label={`Qubits (1–${STAB_MAX})`}
        value={draft ?? String(calc.n)} onFocus={(e) => { setDraft(String(calc.n)); e.target.select(); }}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); } }} />
      <span className="dim">qubit{calc.n === 1 ? "" : "s"}</span>
      <button onClick={() => calc.setQubitCount(calc.n + 1)} disabled={calc.n >= STAB_MAX} aria-label="One qubit more">+</button>
    </span>
  );
}

/** The Circuit tab's dock: the palette, a block/typed sheet, or the trash while dragging. */
function Dock({ calc }: { calc: Calculator }) {
  const drag = useDrag();
  const trash = useRef<HTMLDivElement>(null);
  const deletable = drag && (drag.payload.kind === "move" || (drag.payload.kind === "dot" && drag.payload.role === "control"));
  useEffect(() => {
    setTrash(deletable ? trash.current : null);
    return () => setTrash(null);
  }, [deletable]);
  const over = !!drag?.hover && "trash" in drag.hover;
  return (
    <section className="dock" aria-label="Gate palette">
      {calc.placing ? <PlacingSheet key={calc.placing.item.id + calc.placing.row} calc={calc} /> : <Palette calc={calc} />}
      {deletable && (
        <div ref={trash} className={`trash${over ? " over" : ""}`} aria-hidden>
          🗑 {drag.payload.kind === "move" ? "drop here to delete the gate" : "drop here to remove the control"}
        </div>
      )}
    </section>
  );
}

/** What's being dragged, under the finger. */
function DragGhost() {
  const drag = useDrag();
  if (!drag) return null;
  return <div className="drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden>{drag.label}</div>;
}

export function App() {
  const [calc] = useState(() => new Calculator(createEngine(), load()));
  const version = useSyncExternalStore(calc.subscribe, calc.getVersion);
  const landscape = useMedia(LANDSCAPE);

  // A share link (#q=…) opens as an undoable replace of the saved session.
  useEffect(() => {
    if (!/^#[qz]=/.test(location.hash)) return;
    const hash = location.hash;
    history.replaceState(null, "", location.pathname + location.search);
    void readShareHash(hash).then((shared) => {
      if (!shared) return calc.notify("link: unreadable", "error");
      try {
        calc.loadQasm(shared.qasm, "shared link", shared.scope);
        calc.setMode("tape");
      } catch (e) {
        calc.notify(`link: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    });
  }, [calc]);

  // Persist the session (circuit + settings); replayed on next launch.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(calc.save()));
      } catch {
        /* storage full or blocked */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [calc, version]);

  // Desktop shortcuts: undo/redo, copy/cut/paste, select all; on the selection, Delete, arrows (move) and Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || calc.reportOpen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
        e.preventDefault();
        if (e.key.toLowerCase() === "y" || e.shiftKey) calc.redo();
        else calc.undo();
        return;
      }
      if (calc.mode !== "tape") return;
      const k = e.key.toLowerCase();
      const handled: Record<string, () => void> = mod ? {
        c: () => calc.copySelection(),
        x: () => calc.cutSelection(),
        v: () => calc.paste(),
        a: () => calc.selectAll(),
        d: () => calc.diagSel !== null && calc.duplicateGate(calc.diagSel),
      } : {
        delete: () => calc.deleteSelection(),
        backspace: () => calc.deleteSelection(),
        escape: () => calc.tapCell(null),
        arrowleft: () => calc.nudgeSelected(-1, 0),
        arrowright: () => calc.nudgeSelected(1, 0),
        arrowup: () => calc.nudgeSelected(0, -1),
        arrowdown: () => calc.nudgeSelected(0, 1),
      };
      if (handled[k]) {
        e.preventDefault();
        handled[k]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calc]);

  const n = calc.n;

  // A view summary is shown only once it matches the selected mode. Under
  // noise, PROB/BLOCH/SHOTS come from the analysis worker (ρ or trajectories).
  const noisy = calc.noiseOn && ["prob", "bloch", "shots"].includes(calc.mode);
  const nv = noisy ? calc.noisyView : null;
  const data = noisy ? (nv?.view?.mode === calc.mode ? nv.view : null) : calc.view?.mode === calc.mode ? calc.view : null;
  const view = (() => {
    if (calc.helpOpen) return <HelpView calc={calc} />;
    if (calc.chatOpen) return <ChatView calc={calc} />;
    if (calc.param.open) return <ParamView calc={calc} />;
    if (calc.mode === "lab") return <LabView calc={calc} />;
    if (calc.mode === "tape") return <TapeView calc={calc} />;
    if (noisy && nv?.error) return <div className="view"><div className="lab-error">E: {nv.error}</div></div>;
    if (!data) return <Pending />;
    switch (data.mode) {
      case "ket": return <KetView calc={calc} data={data} />;
      case "prob": return <ProbView calc={calc} data={data} />;
      case "bloch": return <BlochView calc={calc} data={data} />;
      case "shots": return <ShotsView calc={calc} data={data} />;
      default: return <Pending />;
    }
  })();
  const docked = calc.mode === "tape" && !calc.helpOpen && !calc.chatOpen && !calc.param.open;

  return (
    <div className={`calc${landscape ? " landscape" : ""}${docked ? " docked" : ""}`}>

      <nav className="modes" aria-label="Views">
        {MODES.map((m) => (
          <button key={m.id} className={calc.mode === m.id ? "on" : ""} aria-pressed={calc.mode === m.id} onClick={() => calc.setMode(m.id)}>
            {m.label}
          </button>
        ))}
        <button className={calc.chatOpen ? "on" : ""} aria-label="AI chat" aria-pressed={calc.chatOpen} onClick={() => calc.toggleChat()}>AI</button>
      </nav>

      <section className="lcd" aria-live="polite">
        <div className="status">
          <QubitCount calc={calc} />
          <span className="flags">
            {calc.busy && <b className="busy">BUSY</b>}
            {calc.noiseOn && <b className="noise-flag" title={noisy && nv?.view ? `noisy view: ${nv.view.method}` : "noise on"}>NOISE{noisy && nv?.view ? ` · ${nv.view.method}` : ""}</b>}
          </span>
          <span className="grow" />
          {calc.symbols.length > 0 && (
            <button className="sym-badge" onClick={() => (calc.param.open ? calc.closeParams() : calc.openParams())} aria-label="Parameters">
              {calc.playback ? "▶ " : ""}
              {calc.symbols.map((s) => `${symbolGlyph(s)}=${(calc.scope[s] ?? 0).toFixed(2)}`).join(" ")}
            </button>
          )}
          {calc.scrub !== null && (
            <button className="scrub-badge" onClick={() => calc.setScrub(null)} aria-label="Stop scrubbing">@{calc.scrub}/{calc.tape.length} ✕</button>
          )}
          <button className="icon-btn" onClick={() => calc.undo()} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
          <button className="icon-btn" onClick={() => calc.redo()} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">↷</button>
          <button className="icon-btn" aria-label="Help" aria-pressed={calc.helpOpen} onClick={() => calc.toggleHelp()}>?</button>
        </div>

        {calc.mode !== "tape" && (
          <div className="qubits" role="listbox" aria-label="Qubits">
            {n > 64 && calc.sel > 16 && <span className="dim qb-more">q0…</span>}
            {(n > 64 ? [...Array(33).keys()].map((k) => calc.sel - 16 + k).filter((q) => q >= 0 && q < n) : [...Array(n).keys()]).map((q) => (
              <button key={q} role="option" aria-selected={q === calc.sel} className={`qb${q === calc.sel ? " sel" : ""}`} onClick={() => calc.select(q)}>q{q}</button>
            ))}
            {n > 64 && calc.sel < n - 17 && <span className="dim qb-more">…q{n - 1}</span>}
          </div>
        )}

        {view}

        {calc.activeGuide && <GuideBar calc={calc} />}
        {/* Errors, and small notes (importer warnings, confirmations). Echoes ("info") aren't shown. */}
        {calc.message && calc.message.kind !== "info" && (
          <div className={`msg${calc.message.kind === "error" ? " err" : ""}`} role={calc.message.kind === "error" ? "alert" : "status"}>
            {calc.message.kind === "error" ? `E: ${calc.message.text}` : calc.message.text}
          </div>
        )}
      </section>

      {calc.reportOpen && <ReportView calc={calc} />}
      {calc.recording && (
        <div className="rec-pill" role="status">● REC {calc.recording.frame + 1}/{calc.recording.frames}</div>
      )}

      {docked && <Dock calc={calc} />}
      <DragGhost />
    </div>
  );
}

/**
 * Step-through (an example loaded with "▶ step through"): the step the views
 * show and the program's comment for it. ◀ ▶ move the scrub; ✕ ends it.
 */
function GuideBar({ calc }: { calc: Calculator }) {
  const g = calc.activeGuide!;
  const N = calc.tape.length;
  const at = calc.scrub ?? N;
  const text = at === 0 ? g.intro : g.captions[at - 1];
  return (
    <div className="guide" aria-live="polite">
      <div className="guide-head">
        <button onClick={() => calc.setScrub(at - 1)} disabled={at === 0} aria-label="Previous step">◀</button>
        <span className="guide-step">{at === 0 ? g.title : `${at}/${N} · ${formatEntry(calc.tape[at - 1])}`}</span>
        <button onClick={() => calc.setScrub(at + 1)} disabled={at >= N} aria-label="Next step">▶</button>
        <button onClick={() => calc.endGuide()} aria-label="End step-through">✕</button>
      </div>
      {/* fixed height: the buttons stay put while captions come and go */}
      <p className="guide-text">{text || <span className="dim">·</span>}</p>
    </div>
  );
}
