import { useState } from "react";
import type { Calculator } from "../calc/calculator";
import { PALETTE, PALETTE_GROUPS, type PaletteGroup, type PaletteItem } from "../calc/gateSpecs";
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

/** The open group survives the Inspector and sheets replacing the palette. */
let lastGroup: PaletteGroup = "pauli";

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
  const [query, setQuery] = useState("");
  const all = paletteItems(calc);
  const words = fold(query).split(/\s+/).filter(Boolean);
  const items = words.length
    ? all.filter((p) => words.every((w) => fold(`${p.id} ${p.label} ${p.name} ${p.kind === "gate" ? p.gate : ""}`).includes(w)))
    : all.filter((p) => p.group === group);
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
      <div className="palette-tiles" role="list" aria-label={words.length ? "Matching gates" : "Gates"}>
        {items.map((p, i) => (
          <button key={p.id} role="listitem" className={`tile tile-${p.group}${p.label.length > 5 ? " long" : ""}`}
            // Row-major reading order in three rows that scroll sideways.
            style={{ gridRow: Math.floor(i / cols) + 1, gridColumn: (i % cols) + 1 }} title={`${p.name}${p.note ? ` — ${p.note}` : ""}`}
            aria-label={`${p.name}: drag onto a wire, or tap to place it on q${calc.cursor?.row ?? calc.sel}`}
            onPointerDown={(e) => pressToDrag(e, { kind: "new", item: p }, p.label, () => place(p))}
            onClick={(e) => { if (e.detail === 0) place(p); /* keyboard: Enter or Space */ }}>
            {p.label}
          </button>
        ))}
        {!items.length && <span className="dim palette-empty">No gate matches “{query}”.</span>}
      </div>
    </div>
  );
}

/** A block's size (and QAOA's γ, β) or a typed state/matrix, before it goes in. */
export function PlacingSheet({ calc }: { calc: Calculator }) {
  const pl = calc.placing!;
  const { item, row, col } = pl;
  const [k, setK] = useState(String(Math.max(1, calc.n - row)));
  const [gamma, setGamma] = useState("π/4");
  const [beta, setBeta] = useState("π/8");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  const place = () => {
    try {
      if (item.kind === "block") {
        const size = Number(k);
        if (!Number.isInteger(size) || size < 1 || size > calc.n) throw new Error(`1–${calc.n} qubits`);
        const first = Math.max(0, Math.min(row, calc.n - size));
        const qs = Array.from({ length: size }, (_, i) => first + i);
        if (!calc.addBlock(item.block, qs, item.block === "qaoa" ? [gamma, beta] : [], col)) throw new Error(calc.message?.text ?? "refused");
      } else if (item.kind === "typed") {
        calc.addTyped(item.typed, text, row, col);
      }
      calc.closePlacing();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <form className="sheet" onSubmit={(e) => { e.preventDefault(); place(); }}>
      <div className="sheet-head"><b>{item.name}</b> <span className="dim">from q{row}</span></div>
      {item.kind === "block" && (
        <div className="sheet-row">
          <label>qubits <input type="number" inputMode="numeric" min={1} max={calc.n} value={k} onChange={(e) => setK(e.target.value)} onKeyDown={stop} autoFocus /></label>
          {item.block === "qaoa" && <>
            <ExprField className="" label="γ" value={gamma} onChange={setGamma} symbols={calc.symbols} />
            <ExprField className="" label="β" value={beta} onChange={setBeta} symbols={calc.symbols} />
          </>}
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
      <p className="dim note">{item.note}</p>
    </form>
  );
}
