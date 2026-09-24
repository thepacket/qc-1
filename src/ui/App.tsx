import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { Calculator, SHIFTED, type Mode, type Saved } from "../calc/calculator";
import { formatEntry } from "../calc/steps";
import { KEYBOARD, KEYPAD, type KeyDef } from "./keys";
import { BlochView, CatalogView, KetView, Pending, ProbView, ShotsView, TapeView } from "./views";
import { createEngine } from "../calc/engine";
import { LabView } from "./lab/LabView";
import { ParamView } from "./ParamView";
import { symbolGlyph } from "../calc/entry";
import { readShareHash } from "../qasm/share";
import { HelpView } from "./HelpView";
import { ReportView } from "./ReportView";
import { ChatView } from "./ChatView";

export const STORAGE_KEY = "qc1:session:v1";
const UI_KEY = "qc1:ui:v1";

function loadExpanded(): boolean {
  try {
    return localStorage.getItem(UI_KEY) === "expanded";
  } catch {
    return false;
  }
}

/** Keys that stay reachable while the display is expanded. */
const MINI_KEYS = KEYPAD.filter((k) => ["left", "right", "undo", "ac"].includes(k.id));

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

const MODES: { id: Mode; label: string }[] = [
  { id: "tape", label: "CIRC" },
  { id: "ket", label: "KET" },
  { id: "prob", label: "PROB" },
  { id: "bloch", label: "BLOCH" },
  { id: "shots", label: "SHOTS" },
  { id: "lab", label: "LAB" },
];

function buzz() {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* unsupported */
  }
}

/** A phone on its side: the display takes the screen and the keypad slides in on demand. */
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

export function App() {
  const [calc] = useState(() => new Calculator(createEngine(), load()));
  const version = useSyncExternalStore(calc.subscribe, calc.getVersion);
  const [expanded, setExpanded] = useState(loadExpanded);
  const landscape = useMedia(LANDSCAPE);
  const [keysOpen, setKeysOpen] = useState(false);
  const dragY = useRef<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, expanded ? "expanded" : "normal");
    } catch {
      /* storage blocked */
    }
  }, [expanded]);

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

  // The handle under the display: drag down to expand, up to restore, tap to toggle.
  const onHandleDown = (e: PointerEvent) => {
    dragY.current = e.clientY;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onHandleUp = (e: PointerEvent) => {
    if (dragY.current === null) return;
    const dy = e.clientY - dragY.current;
    dragY.current = null;
    if (dy > 24) setExpanded(true);
    else if (dy < -24) setExpanded(false);
    else if (Math.abs(dy) < 8) setExpanded((x) => !x);
  };

  // Persist the session (tape + settings); replayed on next launch.
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || calc.reportOpen) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) calc.press("2nd");
        calc.press("undo");
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === "e") {
        setExpanded((x) => !x);
        return;
      }
      const id = e.key === "`" ? "2nd" : KEYBOARD[e.key];
      if (!id) return;
      e.preventDefault();
      calc.press(id);
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
    if (calc.catalog.open) return <CatalogView calc={calc} />;
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

  const isActive = (k: KeyDef) =>
    (k.id === "2nd" && calc.shift) ||
    (k.id === "all" && calc.all) ||
    (k.id === "ctrl" && calc.marks.some((m) => m.q === calc.sel));

  return (
    <div className={`calc${expanded && !landscape ? " expanded" : ""}${landscape ? " landscape" : ""}${landscape && keysOpen ? " keys-open" : ""}`}>

      <section className="lcd" aria-live="polite">
        <div className="status">
          <span>n={n}</span>
          <span className="flags">
            {calc.busy && <b className="busy">BUSY</b>}
            {calc.catalog.open && <b>CAT</b>}
            {calc.shift && <b>2ND</b>}
            {calc.all && <b>ALL</b>}
            {calc.marks.length > 0 && <b>CTRL</b>}
            {calc.pendingIf && <b>IF c{calc.pendingIf.clbit}={calc.pendingIf.value}</b>}
            {calc.noiseOn && <b className="noise-flag" title={noisy && nv?.view ? `noisy view: ${nv.view.method}` : "noise on"}>NOISE{noisy && nv?.view ? ` · ${nv.view.method}` : ""}</b>}
          </span>
          <span className="grow" />
          {calc.symbols.length > 0 && (
            <button className="sym-badge" onClick={() => (calc.param.open ? calc.closeParams() : calc.openParams())}
              aria-label="Parameters">
              {calc.playback ? "▶ " : ""}
              {calc.symbols.map((s) => `${symbolGlyph(s)}=${(calc.scope[s] ?? 0).toFixed(2)}`).join(" ")}
            </button>
          )}
          {calc.scrub !== null ? (
            <button className="scrub-badge" onClick={() => calc.setScrub(null)} aria-label="Stop scrubbing">
              @{calc.scrub}/{calc.tape.length} ✕
            </button>
          ) : (
            <span>{calc.tape.length} steps</span>
          )}
          <button className="expand-btn" aria-label="AI chat" aria-pressed={calc.chatOpen} onClick={() => calc.toggleChat()}>AI</button>
          <button className="expand-btn" aria-label="Help" aria-pressed={calc.helpOpen} onClick={() => calc.toggleHelp()}>?</button>
          <button
            className="expand-btn"
            aria-label={expanded ? "Show keypad" : "Expand display"}
            aria-pressed={expanded}
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? "⤡" : "⤢"}
          </button>
        </div>

        <div className="qubits" role="listbox" aria-label="Qubits">
          {n > 64 && calc.sel > 16 && <span className="dim qb-more">q0…</span>}
          {(n > 64 ? [...Array(33).keys()].map((k) => calc.sel - 16 + k).filter((q) => q >= 0 && q < n) : [...Array(n).keys()]).map((q) => {
            const mark = calc.marks.find((m) => m.q === q);
            return (
              <button
                key={q}
                role="option"
                aria-selected={q === calc.sel}
                className={`qb${q === calc.sel ? " sel" : ""}${mark ? " marked" : ""}`}
                onClick={() => calc.select(q)}
              >
                {mark ? (mark.anti ? "○" : "●") : ""}q{q}
              </button>
            );
          })}
          {n > 64 && calc.sel < n - 17 && <span className="dim qb-more">…q{n - 1}</span>}
        </div>

        {view}

        {calc.activeGuide && <GuideBar calc={calc} />}
        {/* The entry line shows only when it has something (a typed number, a message). */}
        {/* The typed entry; else an error, or a small note. Keys' own echoes ("info") aren't shown. */}
        {(calc.entry.length > 0 || (calc.message && calc.message.kind !== "info")) && (
          <div className={`entry${calc.entry.length === 0 ? (calc.message?.kind === "error" ? " err" : " note") : ""}`}>
            <bdi>
              {calc.entry.length > 0 ? calc.entryText : calc.message ? (calc.message.kind === "error" ? `E: ${calc.message.text}` : calc.message.text) : " "}
            </bdi>
          </div>
        )}
      </section>

      {calc.reportOpen && <ReportView calc={calc} />}
      {calc.recording && (
        <div className="rec-pill" role="status">● REC {calc.recording.frame + 1}/{calc.recording.frames}</div>
      )}

      <div
        className="handle"
        role="button"
        aria-label={expanded ? "Show keypad" : "Expand display"}
        onPointerDown={onHandleDown}
        onPointerUp={onHandleUp}
        onPointerCancel={() => (dragY.current = null)}
      >
        <span />
      </div>

      <nav className="modes">
        {landscape && (
          <button className={`keys-toggle${keysOpen ? " on" : ""}`} aria-pressed={keysOpen} aria-label={keysOpen ? "Hide the keypad" : "Show the keypad"}
            onClick={() => setKeysOpen((x) => !x)}>
            {keysOpen ? "KEYS ›" : "‹ KEYS"}
          </button>
        )}
        {MODES.map((m) => (
          <button key={m.id} className={calc.mode === m.id ? "on" : ""} onClick={() => { buzz(); calc.setMode(m.id); }}>
            {m.label}
          </button>
        ))}
      </nav>

      <section className="mini-keys" aria-hidden={!expanded}>
        {MINI_KEYS.map((k) => (
          <button
            key={k.id}
            className={`key ${k.kind}`}
            aria-label={calc.shift && k.alt ? k.alt : k.aria}
            tabIndex={expanded ? 0 : -1}
            onClick={() => { buzz(); calc.press(k.id); }}
          >
            {k.label}
          </button>
        ))}
        <button className="key nav" aria-label="Show keypad" tabIndex={expanded ? 0 : -1} onClick={() => setExpanded(false)}>
          ⌃
        </button>
      </section>

      <section className="keypad" aria-hidden={landscape ? !keysOpen : expanded}>
        {KEYPAD.map((k) => (
          <div key={k.id} className={`cell${k.wide ? " wide" : ""}`}>
            <span className={`alt${calc.shift && SHIFTED[k.id] ? " lit" : ""}`}>{k.alt ?? " "}</span>
            <button
              className={`key ${k.kind}${isActive(k) ? " active" : ""}`}
              aria-label={calc.shift && k.alt ? k.alt : k.aria}
              onClick={() => { buzz(); calc.press(k.id); }}
            >
              {k.label}
            </button>
          </div>
        ))}
      </section>
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

