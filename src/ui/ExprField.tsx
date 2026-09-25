import { useRef, useState } from "react";
import { symbolGlyph } from "../calc/entry";

const GREEK = ["θ", "φ", "λ", "α", "β", "γ", "δ", "τ", "ω"];

/**
 * An angle field for the OS keyboard, with a row of keys under it while it has
 * focus: π, √, t, the circuit's symbols (γ₀, β₁…) and the Greek letters, so no
 * one has to hunt for γ or ₀ on a phone keyboard. A key inserts at the cursor
 * and keeps the keyboard up. Plain spellings work too: pi/2, gamma0, theta_1.
 */
export function ExprField({ value, onChange, onCommit, onCancel, symbols, label, hint, className }: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  symbols: string[];
  label: string;
  hint?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const cancelled = useRef(false);
  const used = symbols.filter((s) => s !== "t").map(symbolGlyph);
  const keys = ["π", "√(", "t", ...used, ...GREEK.filter((g) => !used.includes(g))];
  const insert = (k: string) => {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart ?? value.length, b = el.selectionEnd ?? value.length;
    const next = value.slice(0, a) + k + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + k.length, a + k.length); });
  };
  const hold = (e: React.SyntheticEvent) => e.preventDefault(); // keep the focus (and the keyboard) in the field
  return (
    <>
      <label className={className ?? "menu-field"}>
        <span>{label}</span>
        <input ref={ref} value={value} placeholder={hint} aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); if (!cancelled.current) onCommit?.(); cancelled.current = false; }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); ref.current?.blur(); }
            if (e.key === "Escape") { cancelled.current = true; onCancel?.(); ref.current?.blur(); }
          }}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" />
      </label>
      {open && (
        <div className="expr-keys" role="toolbar" aria-label={`Insert into ${label}`} onPointerDown={hold} onMouseDown={hold}>
          {keys.map((k) => (
            <button key={k} type="button" tabIndex={-1} onPointerDown={hold} onMouseDown={hold} onClick={() => insert(k)}>{k === "√(" ? "√" : k}</button>
          ))}
        </div>
      )}
    </>
  );
}
