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
};

const ENDS_VALUE = /[\d.π)]$/;
const STARTS_VALUE = /^(π|\(|sqrt\()/;

export function toExpr(tokens: Token[]): string {
  let out = "";
  for (const t of tokens) {
    const implicit =
      (ENDS_VALUE.test(out) && STARTS_VALUE.test(t.expr)) ||
      (/[π)]$/.test(out) && /^\d/.test(t.expr));
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
