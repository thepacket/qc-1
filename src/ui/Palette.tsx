import { useEffect, useState } from "react";
import type { Calculator } from "../calc/calculator";
import { PALETTE, PALETTE_GROUPS, type PaletteGroup, type PaletteItem } from "../calc/gateSpecs";
import { BLOCK_BY_ID, FAMILIES, defaultSettings, type Family, type Settings } from "../calc/blockLib";
import { CUSTOM_PREFIX } from "../calc/custom";
import { pressToDrag } from "./dnd";
import { TYPED_PRESETS } from "./views";
import { ExprField } from "./ExprField";

/** The palette's items, custom gates included. */
export function paletteItems(calc: Calculator): PaletteItem[] {
  return [
    ...PALETTE,
    ...calc.customGates.map((d): PaletteItem => ({
      kind: "custom", id: CUSTOM_PREFIX + d.name, gate: CUSTOM_PREFIX + d.name, targets: d.k, label: d.name,
      name: `Custom gate ${d.name}`, group: "custom", note: `${d.tape.length} step${d.tape.length > 1 ? "s" : ""} on ${d.k} qubit${d.k > 1 ? "s" : ""}`,
    })),
  ];
}

/** The open group (and block family) survive the Inspector and sheets replacing the palette. */
let lastGroup: PaletteGroup = "pauli";
let lastFamily: Family = "prepare";
const listeners = new Set<() => void>();

/** Show the palette's Blocks group (the diagram menu's Insert block). */
export function openBlocks() {
  lastGroup = "blocks";
  listeners.forEach((f) => f());
}

const fold = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * The gate palette (the Circuit tab's dock when nothing is selected): a
 * search field, the groups, and the tiles in three rows that scroll sideways.
 * Drag a tile up onto a wire to place it there; tap it to place it in the
 * tapped cell (else after the last gate on the selected wire).
 */
export function Palette({ calc }: { calc: Calculator }) {
  const [group, setGroupState] = useState<PaletteGroup>(lastGroup);
  const setGroup = (g: PaletteGroup) => { lastGroup = g; setGroupState(g); };
  const [family, setFamilyState] = useState<Family>(lastFamily);
  const setFamily = (f: Family) => { lastFamily = f; setFamilyState(f); };
  useEffect(() => {
    const f = () => setGroupState(lastGroup);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  const [query, setQuery] = useState("");
  const all = paletteItems(calc);
  const words = fold(query).split(/\s+/).filter(Boolean);
  const items = words.length
    ? all.filter((p) => words.every((w) => fold(`${p.id} ${p.label} ${p.name} ${p.kind === "gate" ? p.gate : ""}`).includes(w)))
    : all.filter((p) => p.group === group && (p.kind !== "block" || p.family === family));
  const blocks = !words.length && group === "blocks";
  const place = (p: PaletteItem) => calc.placeItem(p, calc.cursor?.row ?? calc.sel);
  const cols = Math.max(1, Math.ceil(items.length / 3));
  return (
    <div className="palette">
      <div className="palette-top">
        <input className="palette-search" type="search" placeholder="Search gates" aria-label="Search gates" value={query}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search"
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      {!words.length && (
        <div className="palette-groups" role="tablist" aria-label="Gate groups">
          {PALETTE_GROUPS.filter((g) => g.id !== "custom" || calc.customGates.length).map((g) => (
            <button key={g.id} role="tab" aria-selected={g.id === group} className={g.id === group ? "on" : ""} onClick={() => setGroup(g.id)}>{g.label}</button>
          ))}
        </div>
      )}
      {blocks && (
        <div className="palette-groups palette-families" role="tablist" aria-label="Block families">
          {FAMILIES.map((f) => (
            <button key={f.id} role="tab" aria-selected={f.id === family} className={f.id === family ? "on" : ""} onClick={() => setFamily(f.id)}>{f.label}</button>
          ))}
        </div>
      )}
      <div className={`palette-tiles${blocks ? " palette-blocks" : ""}`} role="list" aria-label={words.length ? "Matching gates" : "Gates"}>
        {items.map((p, i) => (
          <button key={p.id} role="listitem" className={`tile tile-${p.group}${blocks ? " wide" : p.kind === "block" ? " long" : p.label.length > 5 ? " long" : ""}`}
            // Row-major reading order in three rows that scroll sideways (blocks: wide tiles that wrap).
            style={blocks ? undefined : { gridRow: Math.floor(i / cols) + 1, gridColumn: (i % cols) + 1 }} title={`${p.name}${p.note ? ` — ${p.note}` : ""}`}
            aria-label={`${p.name}: drag onto a wire, or tap to place it on q${calc.cursor?.row ?? calc.sel}`}
            onPointerDown={(e) => pressToDrag(e, { kind: "new", item: p }, p.label, () => place(p))}
            onClick={(e) => { if (e.detail === 0) place(p); /* keyboard: Enter or Space */ }}>
            {p.kind === "block" && !blocks ? BLOCK_BY_ID[p.block].label : p.label}
          </button>
        ))}
        {!items.length && <span className="dim palette-empty">No gate matches “{query}”.</span>}
      </div>
    </div>
  );
}

/** A block's size and settings, or a typed state/matrix, before it goes in. */
export function PlacingSheet({ calc }: { calc: Calculator }) {
  const { item, row, col } = calc.placing!;
  const spec = item.kind === "block" ? BLOCK_BY_ID[item.block] : undefined;
  const fixed = spec && spec.maxQubits === spec.minQubits ? spec.minQubits : null;
  // The whole register unless the block is smaller; the drop wire decides where a smaller one goes.
  const k0 = fixed ?? Math.min(calc.n, Math.max(spec?.minQubits ?? 1, spec?.maxQubits ?? calc.n));
  const [k, setK] = useState(String(k0));
  const [settings, setSettings] = useState<Settings>(() => (spec ? defaultSettings(spec, k0) : {}));
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  const set = (key: string, v: string) => { setSettings((x) => ({ ...x, [key]: v })); setTouched((t) => new Set(t).add(key)); setErr(null); };
  const changeK = (v: string) => {
    setK(v);
    setErr(null);
    const n = Number(v);
    if (spec && Number.isInteger(n) && n >= 1) {
      const d = defaultSettings(spec, n);
      setSettings((x) => Object.fromEntries(Object.entries(x).map(([key, val]) => [key, touched.has(key) ? val : d[key]])));
    }
  };
  /** The block's size: from its settings when they fix it, else the qubits field. */
  const size = (): number => {
    if (!spec) return 0;
    const fromSettings = calc.blockSize(spec.id, settings);
    const n = fromSettings ?? fixed ?? Number(k);
    if (!Number.isInteger(n) || n < spec.minQubits || n > calc.n) throw new Error(`${spec.name} needs ${n > calc.n ? `${n} qubits: the circuit has ${calc.n}` : `${spec.minQubits}–${spec.maxQubits ?? calc.n} qubits`}`);
    return n;
  };
  let derived: string | null = null;
  if (spec?.size) { try { derived = `${size()} qubits`; } catch (e) { derived = (e as Error).message; } }
  const place = () => {
    try {
      if (spec) {
        const n = size();
        const first = Math.max(0, Math.min(row, calc.n - n));
        const qs = Array.from({ length: n }, (_, i) => first + i);
        if (!calc.addBlock(spec.id, qs, settings, col)) throw new Error(calc.message?.text ?? "refused");
      } else if (item.kind === "typed") {
        calc.addTyped(item.typed, text, row, col);
      }
      calc.closePlacing();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const kNow = Number(k) || k0;
  /** The qubits it will take: the drop wire on, pulled up to fit. */
  let where = `from q${row}`;
  if (spec) {
    try {
      const n = size(), first = Math.max(0, Math.min(row, calc.n - n));
      where = n === 1 ? `on q${first}` : `on q${first}–q${first + n - 1}`;
    } catch { /* the error shows on Place */ }
  }
  /** Presets are for the block's current size (its settings', when they fix it). */
  let presetK = kNow;
  if (spec?.size) { try { presetK = size(); } catch { presetK = k0; } }
  return (
    <form className="sheet" onSubmit={(e) => { e.preventDefault(); place(); }}>
      <div className="sheet-head"><b>{item.name}</b> <span className="dim">{where}</span></div>
      {spec && (
        <div className="sheet-row">
          {fixed === null && !spec.size && (
            <label>qubits <input type="number" inputMode="numeric" min={spec.minQubits} max={spec.maxQubits ?? calc.n} value={k} onChange={(e) => changeK(e.target.value)} onKeyDown={stop} /></label>
          )}
          {derived && <span className="dim">{derived}</span>}
          {spec.settings.map((d) => {
            const v = settings[d.key] ?? "";
            if (d.kind === "int") return (
              <label key={d.key}>{d.label} <input type="number" inputMode="numeric" min={d.min} max={d.max?.(kNow)} value={v} onChange={(e) => set(d.key, e.target.value)} onKeyDown={stop} /></label>
            );
            if (d.kind === "choice" || d.kind === "symbol") return (
              <label key={d.key}>{d.label} <select value={v} onChange={(e) => set(d.key, e.target.value)}>{d.options!.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select></label>
            );
            if (d.kind === "bool") return (
              <label key={d.key}><input type="checkbox" checked={v !== "no"} onChange={(e) => set(d.key, e.target.checked ? "yes" : "no")} /> {d.label}</label>
            );
            if (d.kind === "gate") {
              const mine = calc.customGates.filter((g) => g.k < calc.n);
              return (
                <label key={d.key}>{d.label} <select value={v} onChange={(e) => set(d.key, e.target.value)}>
                  <option value="">{mine.length ? "choose…" : "none yet (define a gate or type a matrix)"}</option>
                  {mine.map((g) => <option key={g.name} value={g.name}>{g.name} ({g.k} qubit{g.k > 1 ? "s" : ""})</option>)}
                </select></label>
              );
            }
            if (d.kind === "expr") return <ExprField key={d.key} className="" label={d.label} value={v} onChange={(x) => set(d.key, x)} symbols={calc.symbols} />;
            return (
              <div key={d.key} className="sheet-field">
                <label>{d.label} <input className="sheet-wide" value={v} placeholder={d.hint} onChange={(e) => set(d.key, e.target.value)} onKeyDown={stop}
                  autoCapitalize={d.kind === "pauli" ? "characters" : "none"} autoCorrect="off" spellCheck={false} /></label>
                {d.presets && (
                  <div className="cut-picker">
                    {d.presets(presetK).map(([l, t]) => (
                      <button type="button" key={l} className="qb" onClick={() => set(d.key, t)}>{l}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {item.kind === "typed" && (
        <textarea className="sheet-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={stop} autoFocus
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          placeholder={item.typed === "state" ? "|00⟩ + |11⟩   or   0.6, 0, 0, 0.8" : "0,1; 1,0   (rows by ; or new lines, complex like 1+2i)"} />
      )}
      {item.kind === "typed" && (
        <div className="cut-picker">
          {TYPED_PRESETS[item.typed].map(([l, t]) => <button type="button" key={l} className="qb" onClick={() => { setText(t); setErr(null); }}>{l}</button>)}
        </div>
      )}
      {err && <div className="lab-error">{err}</div>}
      <div className="sheet-actions">
        <button type="submit" className="on">Place</button>
        <button type="button" onClick={() => calc.closePlacing()}>Cancel</button>
      </div>
      <p className="dim note">{spec ? spec.note : item.note}</p>
      {spec && <p className="dim note">{spec.qiskit ? <>Checked against <code>{spec.qiskit}</code>.</> : "A QC-1 definition (Qiskit has no object for it), checked against its target state."}</p>}
    </form>
  );
}
