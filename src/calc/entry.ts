/**
 * The numeric entry line. Keys append display tokens (3, π, ÷, √( …); the
 * buffer converts to an expression for the ported evaluator (sim/expr.ts),
 * inserting the implicit multiplications a calculator user expects: 3π,
 * 2√(2), π(1+1).
 */
export type Token = { disp: string; expr: string };

export const TOKENS: Record<string, Token> = {
  "0": { disp: "0", expr: "0" }, "1": { disp: "1", expr: "1" }, "2": { disp: "2", expr: "2" },
  "3": { disp: "3", expr: "3" }, "4": { disp: "4", expr: "4" }, "5": { disp: "5", expr: "5" },
  "6": { disp: "6", expr: "6" }, "7": { disp: "7", expr: "7" }, "8": { disp: "8", expr: "8" },
  "9": { disp: "9", expr: "9" },
  ".": { disp: ".", expr: "." },
  ",": { disp: ",", expr: "," },
  pi: { disp: "π", expr: "π" },
  sqrt: { disp: "√(", expr: "sqrt(" },
  lparen: { disp: "(", expr: "(" },
  rparen: { disp: ")", expr: ")" },
  plus: { disp: "+", expr: "+" },
  minus: { disp: "−", expr: "-" },
  mul: { disp: "×", expr: "*" },
  div: { disp: "÷", expr: "/" },
  tsym: { disp: "t", expr: "t" },
  sin: { disp: "sin(", expr: "sin(" },
  cos: { disp: "cos(", expr: "cos(" },
  exp: { disp: "exp(", expr: "exp(" },
};

/** Symbols the VAR key cycles through (2ND+, repeatedly). Glyphs; sim/expr.ts maps them to ASCII. */
export const VARS = ["θ", "φ", "λ", "α", "β", "γ", "δ", "τ", "ω"];
export const varToken = (g: string): Token => ({ disp: g, expr: g });

/** ASCII scope name → display glyph (theta → θ; t stays t). */
const ASCII: Record<string, string> = {
  theta: "θ", phi: "φ", lambda: "λ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", tau: "τ", omega: "ω",
};
export const symbolGlyph = (name: string) => ASCII[name] ?? name;

const VALUE_END = `[\\d.π)t${VARS.join("")}]$`;
const VALUE_START = `^(π|\\(|sqrt\\(|sin\\(|cos\\(|exp\\(|t|[${VARS.join("")}])`;
const ENDS_VALUE = new RegExp(VALUE_END);
const STARTS_VALUE = new RegExp(VALUE_START);

export function toExpr(tokens: Token[]): string {
  let out = "";
  for (const t of tokens) {
    // Implicit ×: 3π, 2θ, πt, (…)(…), θ2 (a value followed by a value).
    const implicit = ENDS_VALUE.test(out) && (STARTS_VALUE.test(t.expr) || (!/[\d.]$/.test(out) && /^\d/.test(t.expr)));
    out += (implicit ? "*" : "") + t.expr;
  }
  // Close any open parentheses so "√(2" works.
  const open = (out.match(/\(/g) ?? []).length - (out.match(/\)/g) ?? []).length;
  return out + ")".repeat(Math.max(0, open));
}

export function toDisplay(tokens: Token[]): string {
  return tokens.map((t) => t.disp).join("");
}

/** Split a comma-separated entry into per-parameter expressions. */
export function splitArgs(tokens: Token[]): string[] {
  const groups: Token[][] = [[]];
  for (const t of tokens) {
    if (t.expr === ",") groups.push([]);
    else groups[groups.length - 1].push(t);
  }
  return groups.map(toExpr);
}
