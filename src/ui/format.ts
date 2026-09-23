const EPS = 5e-4;

/** Fixed-point with a real minus sign and no "−0.000". */
export function num(x: number, digits = 3): string {
  if (Math.abs(x) < 0.5 * 10 ** -digits) return "0";
  const s = x.toFixed(digits).replace(/\.?0+$/, "");
  return s.replace("-", "−");
}

export function complex(re: number, im: number, digits = 3): string {
  const r = Math.abs(re) >= EPS;
  const i = Math.abs(im) >= EPS;
  if (!i) return num(re, digits);
  const imPart = Math.abs(Math.abs(im) - 1) < EPS ? "i" : `${num(Math.abs(im), digits)}i`;
  if (!r) return (im < 0 ? "−" : "") + imPart;
  return `${num(re, digits)}${im < 0 ? "−" : "+"}${imPart}`;
}

export function pct(p: number): string {
  if (p >= 0.9995) return "100%";
  if (p < 0.0005) return p > 1e-10 ? "<0.1%" : "0%";
  return `${(p * 100).toFixed(1)}%`;
}

export function ket(i: number, n: number): string {
  return `|${i.toString(2).padStart(n, "0")}⟩`;
}
