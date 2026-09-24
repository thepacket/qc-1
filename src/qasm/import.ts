/**
 * OpenQASM 3 (and 2) import: a program becomes a QC-1 tape.
 *
 * Supported: qubit/qreg and bit/creg registers (flattened in declaration
 * order), `input float|angle` symbols, stdgates.inc and QC-1's own gate
 * names, `U`, `CX`, `gphase`, `gate` definitions (nested), the `ctrl @`,
 * `negctrl @`, `inv @`, `pow(k) @` modifiers, register broadcasting,
 * `c[j] = measure q[i]` / `measure q -> c`, `reset`, `barrier` (skipped) and
 * `if (bit == value) stmt` / `{ … }` with `else`.
 *
 * Mapping to the calculator:
 *   - a `gate` without parameters becomes a custom gate (CATALOG), unless it
 *     is numerically one of QC-1's own gates; a parametric one becomes a
 *     custom gate when every call passes the same arguments, else each call
 *     is expanded in place;
 *   - `gphase(α)` becomes e^{iα}·I on a qubit (exact, also when controlled);
 *   - QC-1 measures q into its own bit c[q]; `if` on a program bit reads the
 *     qubit that last wrote it (an error if that qubit was measured again
 *     in between);
 *   - symbols keep QC-1's names (θ φ λ α β γ δ τ ω, t — `t_` too); others
 *     get free Greek letters, with a note.
 */
import type { Entry, Step } from "../calc/steps";
import { applyStep, evalParam } from "../calc/steps";
import { customOf, defineGate, type CustomGate } from "../calc/custom";
import { buildMatrix } from "../sim/matrices";
import { isSafeExpr } from "../sim/expr";

/** `lines[i]` is the source line of the statement that made tape entry i (step-through captions). */
export type ImportResult = { n: number; tape: Entry[]; gates: CustomGate[]; notes: string[]; lines: number[] };

export class QasmImportError extends Error {
  constructor(message: string, readonly line: number) {
    super(`line ${line}: ${message}`);
  }
}

// ─── Tokens ────────────────────────────────────────────────────────────

type Tok = { t: string; line: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let line = 1;
  const re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"[^"]*"|->|==|!=|<=|>=|\*\*|&&|\|\||\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[A-Za-z_Ͱ-Ͽ][\wͰ-Ͽ]*|[{}()[\];,=@+\-*/%<>!?:.^~&|]/gy;
  let m: RegExpExecArray | null;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    m = re.exec(src);
    if (!m) throw new QasmImportError(`unexpected character ${JSON.stringify(src[i])}`, line);
    const s = m[0];
    if (!/^\s|^\/[/*]/.test(s)) out.push({ t: s, line });
    line += (s.match(/\n/g) ?? []).length;
    i = re.lastIndex;
  }
  return out;
}

// ─── AST ───────────────────────────────────────────────────────────────

type Arg = { reg: string; index: number | null };
type Mod = { kind: "ctrl" | "negctrl" | "inv" | "pow"; k: number };
/** QC-1: the most steps one import may expand to (modifiers, broadcasts and nested definitions included). */
export const MAX_IMPORT_STEPS = 100_000;
type Call = { k: "call"; name: string; params: string[]; args: Arg[]; mods: Mod[]; line: number };
type Stmt =
  | Call
  | { k: "measure"; q: Arg; c: Arg | null; line: number }
  | { k: "reset"; q: Arg; line: number }
  | { k: "if"; bit: Arg; value: number; then: Stmt[]; else: Stmt[]; line: number }
  | { k: "gphase"; param: string; mods: Mod[]; args: Arg[]; line: number };
type GateDef = { name: string; params: string[]; qubits: string[]; body: Stmt[]; line: number };

class Parser {
  private i = 0;
  qregs: { name: string; size: number }[] = [];
  cregs: { name: string; size: number }[] = [];
  inputs: string[] = [];
  gates = new Map<string, GateDef>();
  body: Stmt[] = [];
  notes: string[] = [];

  constructor(private toks: Tok[]) {}

  private peek(o = 0) { return this.toks[this.i + o]?.t; }
  private line() { return this.toks[Math.min(this.i, this.toks.length - 1)]?.line ?? 1; }
  private next() {
    const t = this.toks[this.i++];
    if (!t) throw new QasmImportError("unexpected end of program", this.line());
    return t.t;
  }
  private eat(t: string) {
    const got = this.next();
    if (got !== t) throw new QasmImportError(`expected "${t}", got "${got}"`, this.toks[this.i - 1].line);
  }
  private ident() {
    const t = this.next();
    if (!/^[A-Za-z_Ͱ-Ͽ]/.test(t)) throw new QasmImportError(`expected a name, got "${t}"`, this.toks[this.i - 1].line);
    return t;
  }
  private int() {
    const t = this.next();
    if (!/^\d+$/.test(t)) throw new QasmImportError(`expected an integer, got "${t}"`, this.toks[this.i - 1].line);
    return Number(t);
  }

  /** Raw expression text up to a top-level `,` or `)` / `]` (not consumed). */
  private expr(): string {
    let depth = 0;
    const parts: string[] = [];
    for (;;) {
      const t = this.peek();
      if (t === undefined) throw new QasmImportError("unterminated expression", this.line());
      if (depth === 0 && (t === "," || t === ")" || t === "]" || t === ";")) break;
      if (t === "(" || t === "[") depth++;
      if (t === ")" || t === "]") depth--;
      parts.push(this.next());
    }
    return parts.join(" ");
  }

  private exprList(): string[] {
    const out: string[] = [];
    this.eat("(");
    if (this.peek() !== ")") {
      for (;;) {
        out.push(this.expr());
        if (this.peek() === ",") { this.next(); continue; }
        break;
      }
    }
    this.eat(")");
    return out;
  }

  private arg(): Arg {
    const reg = this.ident();
    if (this.peek() === "[") {
      this.next();
      const index = this.int();
      this.eat("]");
      return { reg, index };
    }
    return { reg, index: null };
  }

  private args(): Arg[] {
    const out = [this.arg()];
    while (this.peek() === ",") { this.next(); out.push(this.arg()); }
    return out;
  }

  parse() {
    while (this.i < this.toks.length) {
      const s = this.statement(true);
      if (s) this.body.push(...s);
    }
  }

  /** One statement; null for declarations and ignored statements. */
  private statement(top: boolean): Stmt[] | null {
    const line = this.line();
    const t = this.peek();
    switch (t) {
      case "OPENQASM": this.next(); this.next(); this.eat(";"); return null;
      case "include": this.next(); this.next(); this.eat(";"); return null;
      case "qubit": case "bit": {
        this.next();
        let size = 1;
        if (this.peek() === "[") { this.next(); size = this.int(); this.eat("]"); }
        const name = this.ident();
        this.eat(";");
        (t === "qubit" ? this.qregs : this.cregs).push({ name, size });
        return null;
      }
      case "qreg": case "creg": {
        this.next();
        const name = this.ident();
        this.eat("[");
        const size = this.int();
        this.eat("]");
        this.eat(";");
        (t === "qreg" ? this.qregs : this.cregs).push({ name, size });
        return null;
      }
      case "input": {
        this.next();
        const type = this.next();
        if (type !== "float" && type !== "angle") throw new QasmImportError(`input ${type} isn't supported (float or angle)`, line);
        if (this.peek() === "[") { this.next(); this.int(); this.eat("]"); }
        this.inputs.push(this.ident());
        this.eat(";");
        return null;
      }
      case "gate": {
        if (!top) throw new QasmImportError("gate definitions only at top level", line);
        this.next();
        const name = this.ident();
        const params: string[] = [];
        if (this.peek() === "(") {
          this.next();
          while (this.peek() !== ")") { params.push(this.ident()); if (this.peek() === ",") this.next(); }
          this.next();
        }
        const qubits = [this.ident()];
        while (this.peek() === ",") { this.next(); qubits.push(this.ident()); }
        this.eat("{");
        const body: Stmt[] = [];
        while (this.peek() !== "}") {
          const s = this.statement(false);
          if (s) body.push(...s);
        }
        this.eat("}");
        this.gates.set(name, { name, params, qubits, body, line });
        return null;
      }
      case "barrier": {
        this.next();
        while (this.peek() !== ";") this.next();
        this.eat(";");
        return null;
      }
      case "delay": {
        this.next();
        while (this.peek() !== ";") this.next();
        this.eat(";");
        this.notes.push(`line ${line}: delay skipped (no timing model)`);
        return null;
      }
      case "reset": {
        this.next();
        const q = this.arg();
        this.eat(";");
        return [{ k: "reset", q, line }];
      }
      case "measure": {
        this.next();
        const q = this.arg();
        let c: Arg | null = null;
        if (this.peek() === "->") { this.next(); c = this.arg(); }
        this.eat(";");
        return [{ k: "measure", q, c, line }];
      }
      case "if": return [this.ifStmt()];
      case "for": case "while": case "switch": case "def": case "box": case "let": case "const": case "float": case "int": case "uint": case "bool":
        throw new QasmImportError(`${t} isn't supported`, line);
    }
    // c[j] = measure q[i];
    if (this.peek(1) === "=" || (this.peek(1) === "[" && this.peek(4) === "=")) {
      const c = this.arg();
      this.eat("=");
      this.eat("measure");
      const q = this.arg();
      this.eat(";");
      return [{ k: "measure", q, c, line }];
    }
    return [this.call()];
  }

  private ifStmt(): Stmt {
    const line = this.line();
    this.eat("if");
    this.eat("(");
    let negate = false;
    if (this.peek() === "!") { this.next(); negate = true; }
    const bit = this.arg();
    let value = 1;
    if (this.peek() === "==" || this.peek() === "!=") {
      const op = this.next();
      const v = this.next();
      const n = v === "true" ? 1 : v === "false" ? 0 : Number(v);
      if (!Number.isInteger(n) || n < 0) throw new QasmImportError(`condition value ${v}`, line);
      value = op === "!=" ? (n === 0 ? 1 : 0) : n;
      if (op === "!=" && n > 1) throw new QasmImportError("!= on a register isn't supported", line);
    }
    if (negate) value = value ? 0 : 1;
    this.eat(")");
    const block = (): Stmt[] => {
      if (this.peek() === "{") {
        this.next();
        const out: Stmt[] = [];
        while (this.peek() !== "}") { const s = this.statement(false); if (s) out.push(...s); }
        this.next();
        return out;
      }
      return this.statement(false) ?? [];
    };
    const then = block();
    let otherwise: Stmt[] = [];
    if (this.peek() === "else") { this.next(); otherwise = block(); }
    return { k: "if", bit, value, then, else: otherwise, line };
  }

  private call(): Stmt {
    const line = this.line();
    const mods: Mod[] = [];
    for (;;) {
      const t = this.peek();
      if ((t === "ctrl" || t === "negctrl" || t === "inv" || t === "pow") && (this.peek(1) === "@" || this.peek(1) === "(")) {
        this.next();
        let k = 1;
        if (this.peek() === "(") {
          this.next();
          const e = this.expr();
          this.eat(")");
          k = Number(e.replace(/\s+/g, ""));
          if (!Number.isInteger(k)) throw new QasmImportError(`${t}(${e}): integer expected`, line);
          // QC-1 fix (docs/quantiom-bugs.md #57): bound counts before anything is allocated from them.
          if ((t === "ctrl" || t === "negctrl") && k < 1) throw new QasmImportError(`${t}(${e}): at least 1 control`, line);
          if (Math.abs(k) > MAX_IMPORT_STEPS) throw new QasmImportError(`${t}(${e}): too large (at most ${MAX_IMPORT_STEPS})`, line);
        }
        this.eat("@");
        mods.push({ kind: t, k });
        continue;
      }
      break;
    }
    const name = this.ident();
    const params = this.peek() === "(" ? this.exprList() : [];
    if (name === "gphase") {
      const args = this.peek() === ";" ? [] : this.args();
      this.eat(";");
      return { k: "gphase", param: params[0] ?? "0", mods, args, line };
    }
    const args = this.args();
    this.eat(";");
    return { k: "call", name, params, args, mods, line };
  }
}

// ─── Gate vocabulary ───────────────────────────────────────────────────

/** QASM name → QC-1 base gate, controls taken from the leading qubits. */
const STD: Record<string, { gate: string; controls: number; params?: number }> = {
  id: { gate: "i", controls: 0 }, x: { gate: "x", controls: 0 }, y: { gate: "y", controls: 0 }, z: { gate: "z", controls: 0 },
  h: { gate: "h", controls: 0 }, s: { gate: "s", controls: 0 }, sdg: { gate: "sdg", controls: 0 }, t: { gate: "t", controls: 0 },
  tdg: { gate: "tdg", controls: 0 }, sx: { gate: "sx", controls: 0 }, p: { gate: "p", controls: 0 }, phase: { gate: "p", controls: 0 },
  rx: { gate: "rx", controls: 0 }, ry: { gate: "ry", controls: 0 }, rz: { gate: "rz", controls: 0 },
  U: { gate: "u", controls: 0 }, u: { gate: "u", controls: 0 }, u1: { gate: "u1", controls: 0 }, u2: { gate: "u2", controls: 0 }, u3: { gate: "u3", controls: 0 },
  CX: { gate: "x", controls: 1 }, cx: { gate: "x", controls: 1 }, cy: { gate: "y", controls: 1 }, cz: { gate: "z", controls: 1 },
  ch: { gate: "h", controls: 1 }, cp: { gate: "p", controls: 1 }, cphase: { gate: "p", controls: 1 },
  crx: { gate: "rx", controls: 1 }, cry: { gate: "ry", controls: 1 }, crz: { gate: "rz", controls: 1 },
  cu1: { gate: "u1", controls: 1 }, cu3: { gate: "u3", controls: 1 },
  swap: { gate: "swap", controls: 0 }, ccx: { gate: "x", controls: 2 }, cswap: { gate: "swap", controls: 1 },
  ccz: { gate: "z", controls: 2 }, c3x: { gate: "x", controls: 3 }, c4x: { gate: "x", controls: 4 },
};

/** QC-1's own gates (their names in the export), taken as native when used or defined equivalently. */
const NATIVE = ["sy", "sydg", "sxdg", "iswap", "dcx", "ecr", "rxx", "ryy", "rzz", "rzx", "sqrtswap", "sqrtswapdg",
  "fsim", "xx_plus_yy", "xx_minus_yy", "ms", "r", "gpi", "gpi2", "rccx", "rcccx"];
const NATIVE_ARITY: Record<string, number> = { rccx: 3, rcccx: 4 };

/** Self-inverse (up to nothing) and dagger pairs, for `inv @`. */
const DAGGER: Record<string, string> = { s: "sdg", sdg: "s", t: "tdg", tdg: "t", sx: "sxdg", sxdg: "sx", sy: "sydg", sydg: "sy", sqrtswap: "sqrtswapdg", sqrtswapdg: "sqrtswap" };
const SELF_INV = new Set(["i", "x", "y", "z", "h", "swap", "ecr", "rccx", "rcccx", "gpi"]);
const NEG_FIRST = new Set(["p", "rx", "ry", "rz", "u1", "rxx", "ryy", "rzz", "rzx", "r"]);

const neg = (e: string) => `-(${e})`;

/** The inverse of one base gate with params, or null if there's no closed form. */
function invert(gate: string, params: string[]): { gate: string; params: string[] }[] | null {
  if (SELF_INV.has(gate)) return [{ gate, params }];
  if (DAGGER[gate]) return [{ gate: DAGGER[gate], params }];
  if (NEG_FIRST.has(gate)) return [{ gate, params: [neg(params[0]), ...params.slice(1)] }];
  if (gate === "u" || gate === "u3") return [{ gate, params: [neg(params[0]), neg(params[2]), neg(params[1])] }];
  if (gate === "u2") return [{ gate: "u3", params: ["-(π/2)", neg(params[1]), neg(params[0])] }];
  if (gate === "fsim") return [{ gate, params: [neg(params[0]), neg(params[1])] }];
  if (gate === "xx_plus_yy" || gate === "xx_minus_yy") return [{ gate, params: [neg(params[0]), params[1]] }];
  if (gate === "ms") return [{ gate, params: [params[0], params[1], neg(params[2])] }];
  if (gate === "gpi2") return [{ gate, params: [`(${params[0]})+π`] }];
  if (gate === "iswap") return [{ gate, params }, { gate, params }, { gate, params }];
  if (gate === "dcx") return [{ gate, params }, { gate, params }];
  if (gate === "u_arb") {
    const [ar, ai, br, bi, cr, ci, dr, di] = params;
    return [{ gate, params: [ar, neg(ai), cr, neg(ci), br, neg(bi), dr, neg(di)] }];
  }
  return null;
}

// ─── Building the tape ─────────────────────────────────────────────────

let uid = 0;
const mkStep = (gateId: string, targets: number[], controls: number[], controlStates: boolean[], params: string[]): Step => ({
  id: `imp${uid++}`, gateId, column: 0, targets, controls, clbits: [], params,
  ...(controlStates.some((on) => !on) ? { controlStates } : {}),
});

/** e^{iα}·I as u_arb (exact global phase; a controlled phase when controlled). */
const phaseStep = (alpha: string, q: number, controls: number[], states: boolean[]): Step => {
  const c = `cos(${alpha})`, s = `sin(${alpha})`;
  return mkStep("u_arb", [q], controls, states, [c, s, "0", "0", "0", "0", c, s]);
};

export function importQasm(src: string, existing: CustomGate[] = []): ImportResult {
  // QC-1's export records each measurement's outcome in a comment on the
  // line before it; reading them back makes a round trip exact.
  // (measure_x exports as h, measure, h: the note can sit a few lines up.)
  const recorded: { line: number; o: 0 | 1 }[] = [];
  src.split("\n").forEach((l, i) => {
    const m = /\/\/\s*note:\s*QC-1 measured ([01])/.exec(l);
    if (m) recorded.push({ line: i + 1, o: Number(m[1]) as 0 | 1 });
  });
  let lastNote = 0;
  /** The outcome noted above a measurement/reset at `line` (each note is used once). */
  const noted = (line: number): 0 | 1 | undefined => {
    let found: { line: number; o: 0 | 1 } | undefined;
    for (const r of recorded) if (r.line < line && r.line > lastNote) found = r;
    if (!found) return undefined;
    lastNote = found.line;
    return found.o;
  };
  const p = new Parser(tokenize(src));
  p.parse();
  const notes = [...p.notes];
  if (!p.qregs.length) throw new QasmImportError("no qubits declared", 1);

  // Qubit and bit registers, flattened in declaration order.
  const qbase = new Map<string, { at: number; size: number }>();
  let n = 0;
  for (const r of p.qregs) { qbase.set(r.name, { at: n, size: r.size }); n += r.size; }
  // Above 20 qubits QC-1 runs Clifford programs on a stabilizer tableau (the register decides).
  if (n > 1024) throw new QasmImportError(`${n} qubits (QC-1 goes up to 1024, Clifford only above 20)`, 1);
  const cbase = new Map<string, { at: number; size: number }>();
  let nc = 0;
  for (const r of p.cregs) { cbase.set(r.name, { at: nc, size: r.size }); nc += r.size; }

  // Symbols keep their names (Greek ASCII names show as glyphs; `t_`, the
  // export's name for the t clock, is t). Names used without a declaration
  // are taken as symbols too, with a note.
  const FUNCS = new Set(["sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "sqrt", "exp", "ln", "log", "abs", "pow", "arcsin", "arccos", "arctan"]);
  const RESERVED = new Set(["pi", "π", "tau", "τ", "euler", "ℇ", "e", "E", "PI", "Math", "this", "new", "import"]);
  const sym = new Map<string, string>();
  const symName = (name: string) => (name === "t_" ? "t" : name);
  for (const name of p.inputs) {
    if (FUNCS.has(name) || RESERVED.has(name) && name !== "tau" && name !== "τ") throw new QasmImportError(`symbol name ${name} is reserved`, 1);
    sym.set(name, symName(name));
  }

  /** An expression in QC-1 syntax (π, glyphs), after renaming; `local` maps gate parameters. */
  const expr = (e: string, line: number, local: Map<string, string> = new Map()): string => {
    const out = e.replace(/[A-Za-z_Ͱ-Ͽ][\wͰ-Ͽ]*/g, (id) => {
      if (local.has(id)) return `(${local.get(id)})`;
      if (sym.has(id)) return sym.get(id)!;
      if (id === "pi" || id === "π") return "π";
      if (id === "tau" || id === "τ") return "(2*π)";
      if (id === "euler" || id === "ℇ") return "e";
      if (FUNCS.has(id)) return id;
      if (RESERVED.has(id)) throw new QasmImportError(`"${id}" can't be used in ${e}`, line);
      sym.set(id, symName(id));
      notes.push(`symbol ${id} used without "input float ${id};": taken as a symbol`);
      return sym.get(id)!;
    }).replace(/\s+/g, "").replace(/arcsin/g, "asin").replace(/arccos/g, "acos").replace(/arctan/g, "atan");
    if (!isSafeExpr(out)) throw new QasmImportError(`can't read the expression ${e}`, line);
    return out;
  };

  const resolveQ = (a: Arg, line: number, local?: Map<string, number>): number[] => {
    if (local) {
      if (!local.has(a.reg) || a.index !== null) throw new QasmImportError(`unknown qubit ${a.reg}`, line);
      return [local.get(a.reg)!];
    }
    const r = qbase.get(a.reg);
    if (!r) throw new QasmImportError(`unknown register ${a.reg}`, line);
    if (a.index === null) return Array.from({ length: r.size }, (_, i) => r.at + i);
    if (a.index >= r.size) throw new QasmImportError(`${a.reg}[${a.index}] out of range`, line);
    return [r.at + a.index];
  };
  const resolveC = (a: Arg, line: number): number[] => {
    const r = cbase.get(a.reg);
    if (!r) throw new QasmImportError(`unknown bit register ${a.reg}`, line);
    if (a.index === null) return Array.from({ length: r.size }, (_, i) => r.at + i);
    if (a.index >= r.size) throw new QasmImportError(`${a.reg}[${a.index}] out of range`, line);
    return [r.at + a.index];
  };

  // Gate definitions: native, custom (no parameters, or always the same arguments), or expanded per call.
  const callArgs = new Map<string, Set<string>>();
  const countCalls = (ss: Stmt[]) => {
    for (const s of ss) {
      if (s.k === "call" && p.gates.has(s.name)) {
        const set = callArgs.get(s.name) ?? new Set<string>();
        set.add(JSON.stringify(s.params.map((x) => x.replace(/\s+/g, ""))));
        callArgs.set(s.name, set);
      }
      if (s.k === "if") { countCalls(s.then); countCalls(s.else); }
    }
  };
  countCalls(p.body);
  for (const g of p.gates.values()) countCalls(g.body);

  const customByName = new Map<string, CustomGate>(existing.map((d) => [d.name, d]));
  const created: CustomGate[] = [];
  const nativeDefs = new Set<string>();

  // QC-1 fix (docs/quantiom-bugs.md #57): every emitted step is charged to one budget per import,
  // before it is allocated, so pow(10⁹) or nested definitions can't freeze the page or exhaust memory.
  // A custom gate costs what it expands to when it runs (definitions nest: g1 { g0; g0; }, g2 { g1; g1; }, …).
  let budget = MAX_IMPORT_STEPS;
  const spend = (count: number, line: number) => {
    if (!Number.isSafeInteger(count) || count > budget) throw new QasmImportError(`the circuit expands to more than ${MAX_IMPORT_STEPS} steps`, line);
    budget -= count;
  };
  const expanded = new Map<string, number>();
  const sizeOf = (st: Step, depth = 0): number => {
    if (!st.gateId.startsWith("custom:")) return 1;
    const name = st.gateId.slice(7);
    const known = expanded.get(name);
    if (known !== undefined) return known;
    const def = customByName.get(name) ?? [...customByName.values()].find((d) => d.name === name);
    if (!def || depth > 64) return MAX_IMPORT_STEPS + 1;
    const size = Math.min(MAX_IMPORT_STEPS + 1, def.tape.flat().reduce((a, x) => a + sizeOf(x, depth + 1), 0));
    expanded.set(name, size);
    return size;
  };

  /** Steps for one call on concrete qubits (local = inside a gate body being built). */
  const emit = (
    s: Call | Extract<Stmt, { k: "gphase" }>, qubitsOf: (a: Arg) => number[], paramMap: Map<string, string>, line: number, home = 0,
  ): Step[][] => {
    // Modifiers: controls come first among the arguments, in modifier order.
    const ctrlMods = s.mods.filter((m) => m.kind === "ctrl" || m.kind === "negctrl");
    const nCtrl = ctrlMods.reduce((a, m) => a + m.k, 0);
    const states = ctrlMods.flatMap((m) => Array.from({ length: m.k }, () => m.kind === "ctrl"));
    const invCount = s.mods.filter((m) => m.kind === "inv").length;
    const pow = s.mods.filter((m) => m.kind === "pow").reduce((a, m) => a * m.k, 1);
    if (!Number.isSafeInteger(pow) || Math.abs(pow) > MAX_IMPORT_STEPS) throw new QasmImportError("pow(…) modifiers multiply to too many repetitions", line);
    if (nCtrl > s.args.length) throw new QasmImportError("more controls than qubit arguments", line);
    const inv = (invCount % 2 === 1) !== pow < 0;
    const reps = Math.abs(pow);
    const argQs = s.args.map(qubitsOf);
    // Register broadcast: every whole-register argument has the same length.
    const width = Math.max(1, ...argQs.map((q) => q.length));
    if (argQs.some((q) => q.length !== 1 && q.length !== width)) throw new QasmImportError("registers of different sizes in one call", line);
    const entries: Step[][] = [];
    const entry: Step[] = [];
    for (let b = 0; b < width; b++) {
      const qs = argQs.map((q) => (q.length === 1 ? q[0] : q[b]));
      if (new Set(qs).size !== qs.length) throw new QasmImportError("a qubit appears twice in one gate", line);
      const controls = qs.slice(0, nCtrl);
      const rest = qs.slice(nCtrl);
      let steps: Step[];
      if (s.k === "gphase") {
        const target = rest[0] ?? home;
        const alpha = expr(s.param, line, paramMap);
        steps = [controls.length && rest.length === 0
          ? phaseStep(alpha, controls[controls.length - 1], controls.slice(0, -1), states.slice(0, -1))
          : phaseStep(alpha, target, controls, states)];
        if (inv) steps = [phaseStep(neg(alpha), steps[0].targets[0], steps[0].controls, steps[0].controlStates ?? steps[0].controls.map(() => true))];
      } else {
        steps = baseSteps(s.name, s.params.map((e) => expr(e, line, paramMap)), rest, controls, states, line, inv);
      }
      spend(reps * steps.reduce((a, x) => a + sizeOf(x), 0), line);
      for (let r = 0; r < reps; r++) entry.push(...steps.map((x, i) => ({ ...x, id: `${x.id}.${r}.${i}` })));
    }
    // One entry: a broadcast single-qubit gate reads like ALL on the calculator.
    if (width > 1 && entry.every((x) => x.controls.length === 0 && x.targets.length === 1)) entries.push(entry);
    else for (const x of entry) entries.push([x]);
    return entries;
  };

  /** A named gate's steps: standard, native, or defined in the file. */
  const baseSteps = (name: string, params: string[], qs: number[], controls: number[], states: boolean[], line: number, inv: boolean): Step[] => {
    const def = p.gates.get(name);
    if (def && !nativeDefs.has(name)) {
      if (qs.length !== def.qubits.length) throw new QasmImportError(`${name} takes ${def.qubits.length} qubits`, line);
      if (params.length !== def.params.length) throw new QasmImportError(`${name} takes ${def.params.length} parameters`, line);
      const custom = customByName.get(name);
      if (custom && !inv) {
        return [mkStep(`custom:${custom.name}`, qs, controls, states, [])];
      }
      // Expand the body in place (parametric with varying arguments, or inverted).
      const local = new Map(def.qubits.map((q, j) => [q, qs[j]]));
      const pm = new Map(def.params.map((x, j) => [x, params[j]]));
      const body = def.body.flatMap((b) => expandBody(b, local, pm, def.line)).flat();
      const withCtrl = body.map((x) => ({
        ...x, controls: [...controls, ...x.controls],
        ...(states.some((on) => !on) || x.controlStates ? { controlStates: [...states, ...(x.controlStates ?? x.controls.map(() => true))] } : {}),
      }));
      if (!inv) return withCtrl;
      const out: Step[] = [];
      for (const x of [...withCtrl].reverse()) {
        const r = invert(x.gateId, x.params);
        if (!r) throw new QasmImportError(`inv @ ${name}: can't invert ${x.gateId}`, line);
        out.push(...r.map((g) => ({ ...x, gateId: g.gate, params: g.params })));
      }
      return out;
    }
    const std = STD[name];
    let gate: string, ctl = controls, st = states, tg = qs;
    if (std) {
      gate = std.gate;
      ctl = [...controls, ...qs.slice(0, std.controls)];
      st = [...states, ...qs.slice(0, std.controls).map(() => true)];
      tg = qs.slice(std.controls);
    } else if (NATIVE.includes(name)) {
      if (!def && !notes.some((x) => x.includes(`"${name}"`))) notes.push(`"${name}" used without a definition: taken as QC-1's ${name}`);
      gate = name;
      if (NATIVE_ARITY[name]) { tg = qs; }
    } else if (name === "cu") {
      // cu(θ, φ, λ, γ) = controlled U with the phase γ on the control subspace.
      const [th, ph, la, ga] = params;
      const c = [...controls, qs[0]], cs = [...states, true];
      const out = [mkStep("u", [qs[1]], c, cs, [th, ph, la]), mkStep("p", [qs[0]], controls, states, [ga])];
      return inv ? [mkStep("p", [qs[0]], controls, states, [neg(ga)]), mkStep("u", [qs[1]], c, cs, [neg(th), neg(la), neg(ph)])] : out;
    } else if (customByName.has(name)) {
      return [mkStep(`custom:${name}`, qs, controls, states, [])];
    } else {
      throw new QasmImportError(`unknown gate ${name}`, line);
    }
    let gates = [{ gate, params }];
    if (inv) {
      const r = invert(gate, params);
      if (!r) throw new QasmImportError(`inv @ ${name} isn't supported`, line);
      gates = r;
    }
    return gates.map((g) => mkStep(g.gate, tg, ctl, st, g.params));
  };

  /** A gate body's statement on concrete qubits. */
  const expandBody = (s: Stmt, local: Map<string, number>, pm: Map<string, string>, line: number): Step[][] => {
    if (s.k === "call" || s.k === "gphase") return emit(s, (a) => resolveQ(a, s.line, local), pm, s.line, [...local.values()][0]);
    throw new QasmImportError("only gates inside a gate definition", line);
  };

  // Decide each definition, in order (a body may call earlier ones).
  for (const def of p.gates.values()) {
    const k = def.qubits.length;
    // A definition that names one of QC-1's own gates and matches it numerically is that gate.
    if (NATIVE.includes(def.name) || STD[def.name]) {
      if (matchesNative(def, (qs, pm) => def.body.flatMap((b) => expandBody(b, new Map(def.qubits.map((q, j) => [q, qs[j]])), pm, def.line)).flat())) {
        nativeDefs.add(def.name);
        continue;
      }
      notes.push(`gate ${def.name} differs from QC-1's ${def.name}: kept as defined`);
    }
    const args = callArgs.get(def.name);
    if (def.params.length === 0 || (args && args.size === 1)) {
      const argList: string[] = def.params.length ? JSON.parse([...args!][0]) : [];
      const pm = new Map(def.params.map((x, j) => [x, expr(argList[j], def.line)]));
      const body = def.body.flatMap((b) => expandBody(b, new Map(def.qubits.map((q, j) => [q, j])), pm, def.line));
      let name = def.name;
      for (let i = 2; customByName.has(name) && !created.some((c) => c.name === name); i++) name = `${def.name}_${i}`;
      if (name !== def.name) notes.push(`gate ${def.name} renamed ${name} (the name is taken)`);
      if (body.flat().reduce((a, x) => a + sizeOf(x), 0) > MAX_IMPORT_STEPS) throw new QasmImportError(`gate ${def.name} expands to more than ${MAX_IMPORT_STEPS} steps`, def.line);
      const g = defineGate(name, body);
      // defineGate compacts to the qubits used: keep the declared width.
      const full: CustomGate = { ...g, k, tape: body };
      customByName.set(def.name, full);
      created.push(full);
      // Calls of a parametric gate now pass nothing: its arguments are baked in.
      if (def.params.length) {
        def.params = [];
        for (const s of walk(p.body)) if (s.k === "call" && s.name === def.name) s.params = [];
        for (const g of p.gates.values()) for (const s of walk(g.body)) if (s.k === "call" && s.name === def.name) s.params = [];
      }
    }
  }

  // The program.
  const tape: Entry[] = [];
  const lines: number[] = [];
  const writer = new Map<number, { q: number; gen: number }>(); // program bit → qubit that wrote it
  const gen = new Array<number>(n).fill(0); // measurements of each qubit so far
  const run = (ss: Stmt[], cond: { clbit: number; value: number } | null) => {
    for (const s of ss) {
      if (s.k === "if") {
        const bits = resolveC(s.bit, s.line);
        if (bits.length !== 1) {
          if (s.value > 1 || bits.length > 1) throw new QasmImportError("conditions on a whole bit register aren't supported (use one bit)", s.line);
        }
        const w = writer.get(bits[0]);
        if (!w) {
          // Never written: the bit is 0.
          notes.push(`line ${s.line}: condition on a bit never measured (always ${s.value === 0 ? "true" : "false"})`);
          run(s.value === 0 ? s.then : s.else, cond);
          continue;
        }
        if (w.gen !== gen[w.q]) throw new QasmImportError(`the bit was written by q${w.q}, measured again since (QC-1 keeps one bit per qubit)`, s.line);
        if (cond) throw new QasmImportError("nested if isn't supported", s.line);
        run(s.then, { clbit: w.q, value: s.value });
        if (s.else.length) run(s.else, { clbit: w.q, value: s.value ? 0 : 1 });
        continue;
      }
      if (s.k === "measure" || s.k === "reset") {
        const qs = resolveQ(s.q, s.line);
        const cs = s.k === "measure" && s.c ? resolveC(s.c, s.line) : [];
        if (s.k === "measure" && s.c && cs.length !== qs.length) throw new QasmImportError("measure: register sizes differ", s.line);
        qs.forEach((q, i) => {
          const st: Step = mkStep(s.k === "measure" ? "measure" : "reset", [q], [], [], []);
          const o = qs.length === 1 ? noted(s.line) : undefined;
          if (o !== undefined) st.outcome = o;
          tape.push([cond ? { ...st, condition: cond } : st]);
          lines.push(s.line);
          if (s.k === "measure") {
            gen[q]++;
            if (cs.length) writer.set(cs[i], { q, gen: gen[q] });
          }
        });
        continue;
      }
      for (const e of emit(s, (a) => resolveQ(a, s.line), new Map(), s.line)) {
        tape.push(cond ? e.map((x) => ({ ...x, condition: cond })) : e);
        lines.push(s.line);
      }
    }
  };
  run(p.body, null);

  // Every step must evaluate (symbols defined, expressions valid).
  const scope = Object.fromEntries([...sym.values()].map((g) => [ascii(g), 0.37]));
  for (const s of tape.flat().concat(created.flatMap((d) => d.tape.flat()))) {
    for (const x of s.params) if (Number.isNaN(evalParam(x, scope))) throw new QasmImportError(`can't evaluate ${x}`, 1);
  }
  return { n, tape, gates: created, notes, lines };

  function matchesNative(def: GateDef, body: (qs: number[], pm: Map<string, string>) => Step[]): boolean {
    const k = def.qubits.length;
    const std = STD[def.name];
    const gate = std ? std.gate : def.name;
    if (NATIVE_ARITY[gate] && NATIVE_ARITY[gate] !== k) return false;
    const vals = def.params.map((_, j) => 0.3 + 0.41 * j);
    const pm = new Map(def.params.map((x, j) => [x, String(vals[j])]));
    const steps = body([...Array(k).keys()], pm);
    const ctrl = std?.controls ?? 0;
    const native = mkStep(gate, [...Array(k).keys()].slice(ctrl), [...Array(ctrl).keys()], [], vals.map(String));
    return sameMatrix(k, [native], steps);
  }
}

function* walk(ss: Stmt[]): Generator<Stmt> {
  for (const s of ss) {
    yield s;
    if (s.k === "if") { yield* walk(s.then); yield* walk(s.else); }
  }
}

const ascii = (g: string) => ({ θ: "theta", φ: "phi", λ: "lambda", α: "alpha", β: "beta", γ: "gamma", δ: "delta", τ: "tau", ω: "omega" } as Record<string, string>)[g] ?? g;

/** Exactly equal k-qubit operators (global phase included). */
function sameMatrix(k: number, a: Step[], b: Step[]): boolean {
  // Lazy import cycle-free: simulate both on every basis state.
  const d = 1 << k;
  for (let j = 0; j < d; j++) {
    const x = new Float64Array(2 * d), y = new Float64Array(2 * d);
    x[2 * j] = 1;
    y[2 * j] = 1;
    try {
      for (const s of a) applyAny(x, k, s);
      for (const s of b) applyAny(y, k, s);
    } catch {
      return false;
    }
    for (let i = 0; i < 2 * d; i++) if (Math.abs(x[i] - y[i]) > 1e-9) return false;
  }
  return true;
}

function applyAny(state: Float64Array, n: number, s: Step) {
  if (!customOf(s.gateId) && !s.gateId.startsWith("custom:") && !buildMatrix(s.gateId, s.params.map(() => 0)) && s.gateId !== "rccx" && s.gateId !== "rcccx") {
    throw new Error(`unknown ${s.gateId}`);
  }
  applyStep(state, n, s, Math.random, {});
}
