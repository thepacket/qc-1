import { useEffect, useRef } from "react";

/**
 * LaTeX through KaTeX (ported from Quantiom's Tex), loaded on first use so the
 * calculator's bundle doesn't carry it. KaTeX's defaults stay: `trust` off
 * (no \href, \url, \includegraphics), so math can't link or load anything.
 */

// Dirac notation isn't standard LaTeX: the macros the chat's replies use.
const QUANTUM_MACROS: Record<string, string> = {
  "\\ket": "\\left|#1\\right\\rangle",
  "\\bra": "\\left\\langle#1\\right|",
  "\\braket": "\\left\\langle#1\\middle|#2\\right\\rangle",
  "\\ketbra": "\\left|#1\\middle\\rangle\\middle\\langle#2\\right|",
  "\\expval": "\\left\\langle#1\\right\\rangle",
  "\\tr": "\\operatorname{Tr}",
};

let katex: Promise<typeof import("katex").default> | null = null;
const load = () => (katex ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([k]) => k.default));

export function Tex({ latex, display }: { latex: string; display?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let live = true;
    const el = ref.current;
    if (!el) return;
    el.textContent = latex; // until KaTeX arrives (or if it can't)
    load().then((k) => {
      if (!live) return;
      try {
        k.render(latex, el, { displayMode: !!display, throwOnError: false, strict: "ignore", macros: { ...QUANTUM_MACROS } });
      } catch {
        el.textContent = latex;
      }
    }).catch(() => { /* keep the source text */ });
    return () => { live = false; };
  }, [latex, display]);
  return <span ref={ref} className={display ? "tex tex-display" : "tex"} />;
}
