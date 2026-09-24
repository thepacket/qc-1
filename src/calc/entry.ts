/** ASCII scope name → display glyph (theta → θ; t stays t). */
const ASCII: Record<string, string> = {
  theta: "θ", phi: "φ", lambda: "λ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", tau: "τ", omega: "ω",
};
export const symbolGlyph = (name: string) => ASCII[name] ?? name;
