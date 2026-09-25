/** ASCII scope name → display glyph (theta → θ; t stays t). */
const ASCII: Record<string, string> = {
  theta: "θ", phi: "φ", lambda: "λ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", tau: "τ", omega: "ω",
  epsilon: "ε", zeta: "ζ", eta: "η", iota: "ι", kappa: "κ", mu: "μ", nu: "ν", xi: "ξ", rho: "ρ", sigma: "σ",
  upsilon: "υ", chi: "χ", psi: "ψ",
};
const GREEK = Object.fromEntries(Object.entries(ASCII).map(([a, g]) => [g, a]));
const SUB: Record<string, string> = Object.fromEntries(
  [..."0123456789aehijklmnoprstuvx"].map((c, i) => [c, "₀₁₂₃₄₅₆₇₈₉ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ"[i]]));
const UNSUB = Object.fromEntries(Object.entries(SUB).map(([c, s]) => [s, c]));

/**
 * Display name of a symbol: theta → θ, gamma_0 → γ₀, theta_47 → θ₄₇, x_1 → x₁;
 * a suffix with no subscript glyphs keeps its underscore (theta_b → θ_b).
 */
export function symbolGlyph(name: string): string {
  const m = /^([A-Za-z]+)_([0-9a-z]+)$/.exec(name);
  if (!m) return ASCII[name] ?? name;
  const base = ASCII[m[1]] ?? m[1];
  return [...m[2]].every((c) => SUB[c]) ? base + [...m[2]].map((c) => SUB[c]).join("") : `${base}_${m[2]}`;
}

/**
 * Symbols in typed text to their canonical names, so a phone keyboard is enough:
 * γ₀, γ0, γ_0, gamma0, Gamma_0 → gamma_0; θ, Theta → theta. Other names are kept.
 */
export function symbolNames(text: string): string {
  return text
    .replace(/([α-ωͰ-Ͽ])(_[0-9A-Za-z]+|[₀-₉ₐ-ₜᵢ-ᵥⱼ]+|\d+)?/g, (all, g: string, sub?: string) => {
      const name = GREEK[g];
      if (!name) return all; // π and other letters are left to the parser
      if (!sub) return ` ${name} `;
      return ` ${name}_${sub.startsWith("_") ? sub.slice(1) : [...sub].map((c) => UNSUB[c] ?? c).join("")} `;
    })
    .replace(/[A-Za-z_][A-Za-z0-9_]*/g, canonicalName);
}

/** gamma0, Gamma_0 → gamma_0; Theta → theta; other names as they are. */
export function canonicalName(id: string): string {
  const m = /^([A-Za-z]+?)_?(\d+)$/.exec(id);
  if (m && ASCII[m[1].toLowerCase()]) return `${m[1].toLowerCase()}_${m[2]}`;
  return ASCII[id.toLowerCase()] ? id.toLowerCase() : id;
}
