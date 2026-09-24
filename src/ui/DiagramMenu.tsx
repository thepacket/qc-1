import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Calculator } from "../calc/calculator";
import { formatEntry, measuredBit, NONUNITARY, prettyExpr, writesBit } from "../calc/steps";
import { paramDefs } from "../calc/gateSpecs";
import { CUSTOM_PREFIX } from "../calc/custom";
import { SNIPPETS } from "../calc/snippets";
import { exportQasm3 } from "../qasm/fromTape";
import type { Opts } from "../analysis/types";

/** What a long-press (or a right-click) opened: a gate's menu (by its first step's id), the canvas's, or the selection's. */
export type MenuAt = { x: number; y: number } & ({ kind: "gate"; id: string } | { kind: "canvas" } | { kind: "selection" });

const stop = (e: React.KeyboardEvent) => e.stopPropagation();

/** A text field committed on Enter or when it loses focus (the OS keyboard). */
function Field({ label, value, onCommit, hint }: { label: string; value: string; onCommit: (v: string) => void; hint?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft.trim() !== value) onCommit(draft.trim()); };
  return (
    <label className="menu-field">
      <span>{label}</span>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} placeholder={hint}
        onKeyDown={(e) => { stop(e); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(value); (e.target as HTMLInputElement).blur(); } }}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" aria-label={label} />
    </label>
  );
}

/** `initialize`'s stored amplitudes "(Re α, Im α, Re β, Im β)" as α, β. */
function amplitudes(p: string): [string, string] {
  const v = p.replace(/[()\s]/g, "").split(",").map(Number);
  const fmt = (re: number, im: number) => (Math.abs(im) < 1e-12 ? `${+re.toPrecision(6)}` : `${+re.toPrecision(6)}${im < 0 ? "-" : "+"}${+Math.abs(im).toPrecision(6)}i`);
  return [fmt(v[0] ?? 1, v[1] ?? 0), fmt(v[2] ?? 0, v[3] ?? 0)];
}

/**
 * The diagram's menu at the finger (long-press) or the pointer (right-click),
 * as in Quantiom's editor: a gate's parameters (typed with the OS keyboard:
 * pi/2, 2*theta, t…), duplicate, invert, add / remove / flip a control, a
 * condition on a measured bit, on every qubit, delete. On empty space or a
 * selection: Quantiom's Edit and Transform menus. Tap outside (or Esc) to
 * close it.
 */
export function DiagramMenu({ calc, menu, close }: { calc: Calculator; menu: MenuAt; close: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect(), m = 8;
    setPos({
      left: Math.max(m, Math.min(menu.x, innerWidth - r.width - m)),
      top: menu.y + r.height + m > innerHeight ? Math.max(m, menu.y - r.height) : menu.y,
    });
  }, [menu.x, menu.y, menu.kind]);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    // After this press ends: the long-press that opened the menu must not close it.
    const t = setTimeout(() => window.addEventListener("pointerdown", down, true), 0);
    window.addEventListener("keydown", key);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", down, true); window.removeEventListener("keydown", key); };
  }, [close]);

  const act = (f: () => unknown) => () => { f(); close(); };
  let body: React.ReactNode = null;

  if (menu.kind === "gate") {
    const i = calc.tape.findIndex((e) => e[0]?.id === menu.id);
    const e = calc.tape[i];
    if (!e) return null;
    const s = e[0];
    const defs = paramDefs(s.gateId);
    const custom = s.gateId.startsWith(CUSTOM_PREFIX);
    const unitary = !NONUNITARY.has(s.gateId);
    const broadcast = e.length > 1;
    const states = s.controlStates ?? s.controls.map(() => true);
    const last = s.controls.length - 1;
    const bitList = [...Array(calc.bits).keys()];
    body = <>
      <div className="menu-head">{i + 1}: {formatEntry(e)}</div>
      {s.gateId === "initialize" ? (() => {
        const [a, b] = amplitudes(s.params[0] ?? "");
        return <div className="menu-fields">
          <Field label="α" value={a} onCommit={(v) => calc.setGateParams(i, [v, b])} />
          <Field label="β" value={b} onCommit={(v) => calc.setGateParams(i, [a, v])} />
        </div>;
      })() : s.params.length > 0 && (
        <div className="menu-fields">
          {s.params.map((p, j) => (
            <Field key={j} label={defs[j]?.name ?? `p${j}`} value={prettyExpr(p)} hint={defs[j]?.default}
              onCommit={(v) => calc.setGateParams(i, s.params.map((x, k) => (k === j ? v : x)))} />
          ))}
        </div>
      )}
      {writesBit(s) && (
        <div className="menu-row">
          <span>writes</span>
          <select value={measuredBit(s)} aria-label="Classical bit the measurement writes" onChange={(ev) => calc.setMeasureBit(i, Number(ev.target.value))}>
            {bitList.map((k) => <option key={k} value={k}>c[{k}]</option>)}
          </select>
        </div>
      )}
      <button role="menuitem" onClick={act(() => calc.duplicateGate(i))}>Duplicate</button>
      <button role="menuitem" disabled={!unitary || custom} onClick={act(() => calc.invertGate(i))}>Invert (†)</button>
      <div className="menu-sep" />
      <button role="menuitem" disabled={!unitary || broadcast || s.controls.length + s.targets.length >= calc.n} onClick={act(() => calc.addControlAnywhere(i))}>Add control</button>
      <button role="menuitem" disabled={last < 0} onClick={act(() => calc.removeControl(i, s.controls[last]))}>Remove control</button>
      <button role="menuitem" disabled={last < 0} onClick={act(() => calc.toggleControlState(i, s.controls[last]))}>
        Toggle anti-control{last >= 0 ? ` (q${s.controls[last]}: ${states[last] ? "●→○" : "○→●"})` : ""}
      </button>
      {(broadcast || (s.targets.length === 1 && s.controls.length === 0 && !custom)) && (
        <button role="menuitem" onClick={act(() => calc.setBroadcast(i, !broadcast))}>{broadcast ? "On one qubit" : "On every qubit"}</button>
      )}
      <div className="menu-row">
        <span>only if</span>
        <select value={s.condition ? s.condition.clbit : ""} aria-label="Classical bit"
          onChange={(ev) => calc.setGateCondition(i, ev.target.value === "" ? null : { clbit: Number(ev.target.value), value: (s.condition?.value ?? 1) as 0 | 1 })}>
          <option value="">always</option>
          {bitList.map((k) => <option key={k} value={k}>c[{k}]</option>)}
        </select>
        {s.condition && <>
          <span>=</span>
          <select value={s.condition.value} aria-label="Value"
            onChange={(ev) => calc.setGateCondition(i, { clbit: s.condition!.clbit, value: Number(ev.target.value) as 0 | 1 })}>
            <option value={1}>1</option><option value={0}>0</option>
          </select>
        </>}
      </div>
      <div className="menu-sep" />
      <button role="menuitem" className="danger" onClick={act(() => calc.removeGate(i))}>Delete</button>
    </>;
  } else {
    body = <EditTransform calc={calc} act={act} />;
  }
  return createPortal(
    <div ref={box} className="diagram-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>{body}</div>,
    document.body,
  );
}

let lastTab: "edit" | "transform" = "edit";

/** A menu row: the action, and a hint under it (Quantiom's menus). */
function Item({ label, hint, disabled, onClick, danger }: { label: string; hint?: string; disabled?: boolean; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" className={`menu-item${danger ? " danger" : ""}`} disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );
}

const TARGETS = [
  { value: 0, label: "Clifford + T", hint: "{H, S, T, CX}" },
  { value: 1, label: "IBM", hint: "{RZ, SX, CX}" },
  { value: 2, label: "Rigetti", hint: "{RZ, RX(±π/2), CZ}" },
];
const MAPS = [{ value: 0, label: "Line" }, { value: 1, label: "Ring" }, { value: 2, label: "2-row grid" }];

/**
 * Quantiom's Edit and Transform menus, opened by a long-press on the
 * diagram's empty space or on a selection. Transforms run QC-1's validated
 * circuit tools and replace the circuit (one UNDO) only once checked.
 */
function EditTransform({ calc, act }: { calc: Calculator; act: (f: () => unknown) => () => void }) {
  const [tab, setTab] = useState(lastTab);
  const [times, setTimes] = useState("3");
  const [depth, setDepth] = useState("3");
  const pick = (t: typeof tab) => { lastTab = t; setTab(t); };
  const sel = calc.diagSet.size || (calc.diagSel !== null ? 1 : 0);
  const none = "select gates first: long-press empty space, then drag";
  const empty = calc.tape.length === 0;
  const run = (id: string, opts: Opts, label: string) => act(() => calc.transform(id, opts, label));
  return <>
    <div className="menu-tabs" role="tablist">
      <button role="tab" aria-selected={tab === "edit"} className={tab === "edit" ? "on" : ""} onClick={() => pick("edit")}>Edit</button>
      <button role="tab" aria-selected={tab === "transform"} className={tab === "transform" ? "on" : ""} onClick={() => pick("transform")}>Transform</button>
    </div>
    <div className="menu-scroll">
      {tab === "edit" ? <>
        <Item label="Undo" hint="Ctrl+Z" onClick={act(() => calc.undo())} />
        <Item label="Redo" hint="Ctrl+Shift+Z" disabled={!calc.redoDepth} onClick={act(() => calc.redo())} />
        <div className="menu-cat">Clipboard</div>
        <Item label="Copy circuit" hint="the circuit as OpenQASM 3 → clipboard" disabled={empty}
          onClick={act(async () => {
            try { await navigator.clipboard.writeText(exportQasm3(calc.n, calc.tape, calc.bits)); calc.notify("circuit copied (OpenQASM 3)"); }
            catch { calc.notify("copy blocked", "error"); }
          })} />
        <Item label="Paste circuit" hint="OpenQASM in the clipboard → the circuit (UNDO restores)"
          onClick={act(async () => {
            try { calc.pasteCircuit(await navigator.clipboard.readText()); }
            catch { calc.notify("paste blocked: use MENU → Import QASM", "error"); }
          })} />
        <div className="menu-cat">Selection</div>
        <Item label="Copy selection" hint={sel ? `${sel} gate${sel > 1 ? "s" : ""} → gate clipboard` : none} disabled={!sel} onClick={act(() => calc.copySelection())} />
        <Item label="Cut selection" hint={sel ? `${sel} gate${sel > 1 ? "s" : ""} → gate clipboard, removed` : none} disabled={!sel} onClick={act(() => calc.cutSelection())} />
        <Item label="Paste selection" hint={calc.clip ? "the copied gates after the circuit" : "the gate clipboard is empty"} disabled={!calc.clip} onClick={act(() => calc.paste())} />
        <div className="menu-row">
          <button className="menu-item grow" disabled={!sel} onClick={act(() => calc.repeatSelection(Math.max(1, Math.min(100, Math.floor(Number(times)) || 1))))}>
            <span>Repeat selection ×N</span>
            <span className="menu-hint">{sel ? "N copies after the circuit: ansatz / Trotter layers" : none}</span>
          </button>
          <input className="menu-num" type="number" inputMode="numeric" min={1} max={100} value={times} aria-label="N"
            onChange={(e) => setTimes(e.target.value)} onKeyDown={stop} />
        </div>
        <Item label="Fold selection" hint={sel ? "its columns into one box (tap the box to unfold)" : none} disabled={!sel} onClick={act(() => calc.foldSelection())} />
        <Item label="Select all" disabled={empty} onClick={act(() => calc.selectAll())} />
        <div className="menu-cat">Insert block</div>
        {SNIPPETS.map((sn) => (
          <Item key={sn.id} label={sn.label} hint={calc.n >= sn.minQubits ? sn.hint : `needs ${sn.minQubits}+ qubits`} disabled={calc.n < sn.minQubits}
            onClick={act(() => calc.insertSnippet(sn.id))} />
        ))}
        <div className="menu-cat">Circuit</div>
        <Item label="Clear" hint="remove every gate (UNDO restores)" danger disabled={empty} onClick={act(() => calc.clearCircuit())} />
      </> : <>
        <Item label="Compact" hint="every gate as far left as it goes" disabled={empty} onClick={act(() => calc.compactColumns())} />
        <Item label="Append U†" hint="the inverse of the circuit, after it" disabled={empty} onClick={run("inverse", { mode: 0 }, "Append U†")} />
        <Item label="Optimise" hint="peephole rewrites (safe)" disabled={empty} onClick={run("simplify", { deep: 0 }, "Optimise")} />
        <Item label="Optimise (deep)" hint="+ commute through diagonals; may reflow the layout" disabled={empty} onClick={run("simplify", { deep: 1 }, "Optimise (deep)")} />
        <div className="menu-row">
          <button className="menu-item grow" onClick={run("randclifford", { depth: Math.max(1, Math.min(8, Math.floor(Number(depth)) || 3)) }, "Random Clifford")}>
            <span>Random Clifford…</span>
            <span className="menu-hint">replaces the circuit; depth 1–8</span>
          </button>
          <input className="menu-num" type="number" inputMode="numeric" min={1} max={8} value={depth} aria-label="Depth"
            onChange={(e) => setDepth(e.target.value)} onKeyDown={stop} />
        </div>
        <div className="menu-cat">Transpile to native →</div>
        {TARGETS.map((t) => <Item key={`tp${t.value}`} label={t.label} hint={t.hint} disabled={empty} onClick={run("transpile", { target: t.value }, `Transpile → ${t.label}`)} />)}
        <div className="menu-cat">Compile (transpile + optimise) →</div>
        {TARGETS.map((t) => <Item key={`cp${t.value}`} label={t.label} hint={t.hint} disabled={empty} onClick={run("compile", { target: t.value, coupling: 0 }, `Compile → ${t.label}`)} />)}
        <div className="menu-cat">Route: insert SWAPs →</div>
        {MAPS.map((m) => <Item key={`rt${m.value}`} label={m.label} hint="every 2-qubit gate on neighbours; qubits end relabelled" disabled={empty || calc.n < 2}
          onClick={run("route", { coupling: m.value }, `Route → ${m.label.toLowerCase()}`)} />)}
      </>}
    </div>
  </>;
}
