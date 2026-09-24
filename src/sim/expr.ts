/**
 * Tiny expression evaluator for gate parameters.
 *
 * The user writes things like `π/2`, `θ`, `2*t + π/4`, `sin(t)`. Unknown
 * identifiers become free variables whose values come from a scope at call
 * time (zero if missing). QC-1: parsed and evaluated here, never compiled as
 * JavaScript (expressions also come from files and share links; see below).
 */

const GREEK_TO_ASCII: Array<[string, string]> = [
  ["π", "PI"],     // π → Math.PI handled by JS_FN_REPLACE below
  ["θ", "theta"],
  ["φ", "phi"],
  ["λ", "lambda"],
  ["γ", "gamma"],
  ["β", "beta"],
  ["τ", "tau"],
  ["α", "alpha"],
  ["δ", "delta"],
  ["ω", "omega"],
];

// Names that map to JS Math.* and therefore aren't free variables.
const RESERVED = new Set<string>([
  "PI", "pi", "E", "e",
  "sin", "cos", "tan", "asin", "acos", "atan",
  "sinh", "cosh", "tanh",
  "sqrt", "abs", "exp", "ln", "log", "pow",
  "Math",
]);

const IDENT_RE = /[a-zA-Z_][a-zA-Z0-9_]*/g;

function preprocess(src: string): { js: string; freeVars: string[] } {
  let js = src.trim();
  if (!js) return { js: "0", freeVars: [] };
  for (const [glyph, ascii] of GREEK_TO_ASCII) js = js.split(glyph).join(ascii);

  // Replace math identifiers with their JS Math.* form.
  js = js
    .replace(/\bPI\b/g, "(Math.PI)")
    .replace(/\bpi\b/g, "(Math.PI)")
    .replace(/\bE\b/g, "(Math.E)")
    // QC-1: a bare `e` is reserved (never a free variable) but was left
    // undefined, so it evaluated to 0; it is Euler's number.
    .replace(/\be\b/g, "(Math.E)")
    .replace(/\bsin\b/g, "Math.sin")
    .replace(/\bcos\b/g, "Math.cos")
    .replace(/\btan\b/g, "Math.tan")
    .replace(/\basin\b/g, "Math.asin")
    .replace(/\bacos\b/g, "Math.acos")
    .replace(/\batan\b/g, "Math.atan")
    .replace(/\bsinh\b/g, "Math.sinh")
    .replace(/\bcosh\b/g, "Math.cosh")
    .replace(/\btanh\b/g, "Math.tanh")
    .replace(/\bsqrt\b/g, "Math.sqrt")
    .replace(/\babs\b/g, "Math.abs")
    .replace(/\bexp\b/g, "Math.exp")
    .replace(/\bln\b/g, "Math.log")
    .replace(/\blog\b/g, "Math.log")
    .replace(/\bpow\b/g, "Math.pow");

  const freeVars: string[] = [];
  const seen = new Set<string>();
  for (const m of js.matchAll(IDENT_RE)) {
    const name = m[0];
    if (RESERVED.has(name)) continue;
    if (name.startsWith("Math")) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    freeVars.push(name);
  }
  return { js, freeVars };
}

// QC-1 fix (docs/quantiom-bugs.md #20, #56): upstream compiles any text with
// `new Function` ("trust-the-author"). QC-1 also reads expressions from files,
// share links and the AI's proposals, and a character filter over JavaScript
// wasn't enough (`sin++` rewrote to `Math.sin++`, overwriting Math.sin). So an
// expression is parsed here into a tree of closures and never becomes code:
//
//   expr    := cond
//   cond    := compare ( "?" cond ":" cond )?
//   compare := sum ( ("<" | "<=" | ">" | ">=" | "==" | "!=" | "===" | "!==") sum )*
//   sum     := product ( ("+" | "-") product )*
//   product := unary ( ("*" | "/" | "%") unary )*
//   unary   := ("+" | "-") unary | power
//   power   := call ( "**" unary )?            (right-associative)
//   call    := number | name | name "(" args ")" | "(" expr ")"
//
// Names are free symbols (values from the scope, 0 if missing), the constants
// pi/PI/e/E (π after the Greek mapping), or the functions below. Comparisons
// give 1 or 0, as in JavaScript arithmetic. Nothing can assign or reach a global.
const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log, pow: Math.pow,
};
const ARITY: Record<string, number> = { pow: 2 };
const CONSTS: Record<string, number> = { PI: Math.PI, pi: Math.PI, E: Math.E, e: Math.E };
const MAX_LEN = 4096;

type Node = (scope: Record<string, number>) => number;
type Token = { k: "num"; v: number } | { k: "name"; v: string } | { k: "op"; v: string };
const TOKEN_RE = /\s*(?:((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|===|!==|==|!=|<=|>=|[-+*/%()<>?:,]))/y;

function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let at = 0;
  while (at < src.length) {
    if (/^\s*$/.test(src.slice(at))) break;
    TOKEN_RE.lastIndex = at;
    const m = TOKEN_RE.exec(src);
    if (!m) return null;
    at = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) out.push({ k: "num", v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ k: "name", v: m[2] });
    else out.push({ k: "op", v: m[3] });
  }
  return out;
}

/** Parse to a closure tree, or null. `free` collects free symbols in order of appearance. */
function parse(src: string, free: string[]): Node | null {
  let s = src;
  for (const [glyph, ascii] of GREEK_TO_ASCII) s = s.split(glyph).join(` ${ascii} `);
  if (s.length > MAX_LEN) return null;
  const toks = tokenize(s);
  if (!toks) return null;
  if (!toks.length) return () => 0;
  let i = 0, depth = 0;
  const peek = (v: string) => toks[i]?.k === "op" && toks[i].v === v;
  const take = (v: string) => (peek(v) ? (i++, true) : false);
  const fail = (): never => { throw new SyntaxError("bad expression"); };
  const expect = (v: string) => { if (!take(v)) fail(); };
  const nest = <T,>(f: () => T): T => { if (++depth > 200) fail(); try { return f(); } finally { depth--; } };

  const cond = (): Node => nest(() => {
    const c = compare();
    if (!take("?")) return c;
    const a = cond(); expect(":"); const b = cond();
    return (sc) => (c(sc) ? a(sc) : b(sc));
  });
  const CMP: Record<string, (a: number, b: number) => boolean> = {
    "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b,
    "==": (a, b) => a === b, "===": (a, b) => a === b, "!=": (a, b) => a !== b, "!==": (a, b) => a !== b,
  };
  const compare = (): Node => {
    let l = sum();
    while (toks[i]?.k === "op" && CMP[toks[i].v]) {
      const f = CMP[toks[i++].v], a = l, b = sum();
      l = (sc) => (f(a(sc), b(sc)) ? 1 : 0);
    }
    return l;
  };
  const sum = (): Node => {
    let l = product();
    for (;;) {
      if (take("+")) { const a = l, b = product(); l = (sc) => a(sc) + b(sc); }
      else if (take("-")) { const a = l, b = product(); l = (sc) => a(sc) - b(sc); }
      else return l;
    }
  };
  const product = (): Node => {
    let l = unary();
    for (;;) {
      if (take("*")) { const a = l, b = unary(); l = (sc) => a(sc) * b(sc); }
      else if (take("/")) { const a = l, b = unary(); l = (sc) => a(sc) / b(sc); }
      else if (take("%")) { const a = l, b = unary(); l = (sc) => a(sc) % b(sc); }
      else return l;
    }
  };
  const unary = (): Node => nest(() => {
    if (take("-")) { const a = unary(); return (sc) => -a(sc); }
    if (take("+")) { const a = unary(); return a; }
    return power();
  });
  const power = (): Node => {
    const base = call();
    if (!take("**")) return base;
    const ex = unary();
    return (sc) => base(sc) ** ex(sc);
  };
  const call = (): Node => {
    const t = toks[i++];
    if (!t) return fail();
    if (t.k === "num") { const v = t.v; return () => v; }
    if (t.k === "op") {
      if (t.v !== "(") return fail();
      const e = cond(); expect(")"); return e;
    }
    const name = t.v;
    if (take("(")) {
      const f = Object.prototype.hasOwnProperty.call(FUNCS, name) ? FUNCS[name] : undefined;
      if (!f) return fail();
      const args: Node[] = [];
      if (!take(")")) { do args.push(cond()); while (take(",")); expect(")"); }
      if (args.length !== (ARITY[name] ?? 1)) return fail();
      return args.length === 1 ? (sc) => f(args[0](sc)) : (sc) => f(...args.map((a) => a(sc)));
    }
    if (Object.prototype.hasOwnProperty.call(CONSTS, name)) { const v = CONSTS[name]; return () => v; }
    if (Object.prototype.hasOwnProperty.call(FUNCS, name) || DENY.has(name)) return fail(); // a function name without a call, or a reserved word
    if (!free.includes(name)) free.push(name);
    return (sc) => (Object.prototype.hasOwnProperty.call(sc, name) ? sc[name] : 0);
  };

  try {
    const root = cond();
    return i === toks.length ? root : null;
  } catch {
    return null;
  }
}
const DENY = new Set(["Math", "this", "new", "import", "eval", "Function", "globalThis", "self", "window", "constructor", "prototype", "__proto__"]);

/** True when `src` parses as an angle expression (see the grammar above). */
export function isSafeExpr(src: string): boolean {
  return parse(src, []) !== null;
}

export function compileExpr(src: string): {
  freeVars: string[];
  eval: (scope: Record<string, number>) => number;
} {
  const freeVars: string[] = [];
  const root = parse(src, freeVars);
  if (!root) return { freeVars: [], eval: () => NaN };
  return {
    freeVars,
    eval: (scope) => {
      const r = root(scope);
      return Number.isFinite(r) ? r : 0;
    },
  };
}

/** Convenience: evaluate once with no caching. */
export function evalExpr(src: string, scope: Record<string, number>): number {
  return compileExpr(src).eval(scope);
}

/** Identifiers referenced by an expression, after Greek and math-name pruning. */
export function detectFreeVars(src: string): string[] {
  const free: string[] = [];
  return parse(src, free) ? free : preprocess(src).freeVars;
}
