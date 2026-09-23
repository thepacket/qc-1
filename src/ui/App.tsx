import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { Calculator, SHIFTED, type Mode, type Saved } from "../calc/calculator";
import { formatEntry } from "../calc/steps";
import { KEYBOARD, KEYPAD, type KeyDef } from "./keys";
import { BlochView, CatalogView, KetView, Pending, ProbView, ShotsView, TapeView } from "./views";
import { createEngine } from "../calc/engine";

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
  { id: "ket", label: "KET" },
  { id: "prob", label: "PROB" },
  { id: "bloch", label: "BLOCH" },
  { id: "shots", label: "SHOTS" },
  { id: "tape", label: "TAPE" },
];

function buzz() {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* unsupported */
  }
}

export function App() {
  const [calc] = useState(() => new Calculator(createEngine(), load()));
  const version = useSyncExternalStore(calc.subscribe, calc.getVersion);
  const [expanded, setExpanded] = useState(loadExpanded);
  const dragY = useRef<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, expanded ? "expanded" : "normal");
    } catch {
      /* storage blocked */
    }
  }, [expanded]);

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
      if (e.altKey) return;
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
  const last = calc.tape.slice(-6);

  // A view summary is shown only once it matches the selected mode.
  const data = calc.view?.mode === calc.mode ? calc.view : null;
  const view = (() => {
    if (calc.catalog.open) return <CatalogView calc={calc} />;
    if (calc.mode === "tape") return <TapeView calc={calc} />;
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
    <div className={`calc${expanded ? " expanded" : ""}`}>
      <header className="brand">
        <span className="logo">QC-1</span>
        <span className="model">QUANTUM CALCULATOR ONE</span>
      </header>

      <section className="lcd" aria-live="polite">
        <div className="status">
          <span>n={n}</span>
          <span className="flags">
            {calc.busy && <b className="busy">BUSY</b>}
            {calc.catalog.open && <b>CAT</b>}
            {calc.shift && <b>2ND</b>}
            {calc.all && <b>ALL</b>}
            {calc.marks.length > 0 && <b>CTRL</b>}
          </span>
          <span className="grow" />
          <span>{calc.tape.length} steps</span>
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
          {[...Array(n).keys()].map((q) => {
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
        </div>

        {view}

        <div className="tape-strip">
          {last.length === 0 ? <span className="dim">ready</span> : last.map((e, i) => <span key={i}>{formatEntry(e)}</span>)}
        </div>
        <div className={`entry${calc.message?.kind === "error" && calc.entry.length === 0 ? " err" : ""}`}>
          <bdi>
            {calc.entry.length > 0 ? calc.entryText : calc.message ? (calc.message.kind === "error" ? `E: ${calc.message.text}` : calc.message.text) : " "}
          </bdi>
        </div>
      </section>

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

      <section className="keypad" aria-hidden={expanded}>
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
