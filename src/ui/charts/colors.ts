/**
 * Chart colour scales on the dark display surface (#1a1a19). Stops come from
 * the data-viz reference palette's dark steps; lightness rises monotonically
 * along the sequential ramp and away from the neutral diverging midpoint.
 */

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const css = ([r, g, b]: RGB) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;

function ramp(stops: string[], t: number): string {
  const c = stops.map(hex);
  const x = Math.max(0, Math.min(1, t)) * (c.length - 1);
  const i = Math.min(c.length - 2, Math.floor(x));
  return css(mix(c[i], c[i + 1], x - i));
}

/** Sequential (magnitude): near-surface → bright blue. */
const SEQ = ["#232a33", "#184f95", "#2a78d6", "#5598e7", "#9ec5f4"];
export const seqColor = (t: number) => ramp(SEQ, t);

/** Diverging (sign): blue (−) ← neutral grey → red (+). */
const DIV_NEG = ["#383835", "#256abf", "#5598e7"];
const DIV_POS = ["#383835", "#c34b4b", "#e66767"];
export const divColor = (t: number) => (t < 0 ? ramp(DIV_NEG, -t) : ramp(DIV_POS, t));

/** OKLCH → sRGB (for the cyclic phase hue at constant lightness/chroma). */
function oklch(L: number, C: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3];
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const enc = (x: number) => 255 * Math.max(0, Math.min(1, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
  return css(lin.map(enc) as RGB);
}

/** Phase (radians) → hue at fixed lightness, so no phase looks "bigger". 0 rad = blue. */
export const phaseColor = (phi: number) => oklch(0.7, 0.13, 255 + (phi * 180) / Math.PI);

export const fmt = (x: number, d = 3) => {
  if (!Number.isFinite(x)) return "—";
  if (Math.abs(x) < 0.5 * 10 ** -d) return "0";
  return x.toFixed(d).replace(/\.?0+$/, "").replace("-", "−");
};
export const fmtC = (re: number, im: number) => {
  if (Math.abs(im) < 5e-4) return fmt(re);
  if (Math.abs(re) < 5e-4) return `${fmt(im)}i`;
  return `${fmt(re)}${im < 0 ? "−" : "+"}${fmt(Math.abs(im))}i`;
};
