/**
 * Qiskit (Python) export: the tape as a script that builds a QuantumCircuit.
 *
 * It is a translation of QC-1's own OpenQASM 3 export (validated against
 * Qiskit's importer), statement by statement: every `gate` definition becomes
 * a sub-circuit gate (its gphase kept), `ctrl @` / `negctrl @` / `inv @`
 * become .control(k, ctrl_state) / .inverse(), `if (c[k] == …)` becomes
 * `with qc.if_test(...)`, symbols become Parameters (t as "t"). Checked by
 * running the script: validation/ref/g_qiskit.py compares its statevector
 * with QC-1's, exactly (global phase included).
 *
 * Upstream's emitQiskit dropped `if` conditions and had no mapping for
 * several gates (docs/quantiom-bugs.md #5); it is not ported.
 */
import type { Entry } from "../calc/steps";
import { exportQasm3 } from "./fromTape";

const STD: Record<string, string> = {
  id: "IGate", x: "XGate", y: "YGate", z: "ZGate", h: "HGate", s: "SGate", sdg: "SdgGate", t: "TGate", tdg: "TdgGate",
  sx: "SXGate", p: "PhaseGate", phase: "PhaseGate", rx: "RXGate", ry: "RYGate", rz: "RZGate", U: "UGate", u: "UGate",
  u1: "U1Gate", u2: "U2Gate", u3: "U3Gate", cx: "CXGate", CX: "CXGate", cy: "CYGate", cz: "CZGate", ch: "CHGate",
  cp: "CPhaseGate", cphase: "CPhaseGate", crx: "CRXGate", cry: "CRYGate", crz: "CRZGate", cu: "CUGate",
  swap: "SwapGate", ccx: "CCXGate", cswap: "CSwapGate",
};

const FUNCS = ["sin", "cos", "tan", "exp", "sqrt", "ln", "log", "asin", "acos", "atan"];

const PY_KEYWORDS = new Set(["False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
  "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass",
  "raise", "return", "try", "while", "with", "yield", "math", "pi", "qc", "qr", "cr", "sub"]);

/** A symbol's Python variable name (Python keywords and the script's own names get a trailing _). */
const pyName = (name: string) => (PY_KEYWORDS.has(name) ? `${name}_` : name);

/** A QASM expression as Python (functions through helpers that accept Parameters). */
function pyExpr(e: string, symbols: Set<string>): string {
  let out = e.trim();
  for (const f of FUNCS) out = out.replace(new RegExp(`\\b${f}\\s*\\(`, "g"), `_${f}(`);
  return out.replace(/\b[A-Za-z_]\w*\b/g, (id) => (symbols.has(id) ? pyName(id) : id));
}

/** Split `a, b(c, d), e` at top-level commas. */
function args(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

type Ctx = { qubit: (ref: string) => string; indent: string; symbols: Set<string> };

/** One gate statement (no trailing `;`) as Python lines appending to `target`. */
function gateLine(stmt: string, target: string, ctx: Ctx): string[] {
  const m = /^((?:(?:ctrl|negctrl|inv)(?:\(\d+\))?\s*@\s*)*)([A-Za-z_]\w*)\s*(?:\((.*)\))?\s+(.+)$/.exec(stmt);
  if (!m) throw new Error(`can't translate: ${stmt}`);
  const [, modText, name, paramText, qubitText] = m;
  const params = paramText ? args(paramText).map((x) => pyExpr(x, ctx.symbols)) : [];
  let g = STD[name] ? `${STD[name]}(${params.join(", ")})` : `_gate_${name}(${params.join(", ")})`;
  // Modifiers apply right to left; the controls come first among the qubits, in order.
  const mods = [...modText.matchAll(/(ctrl|negctrl|inv)(?:\((\d+)\))?/g)].map((x) => ({ kind: x[1], k: Number(x[2] ?? 1) }));
  const bits: number[] = [];
  for (const md of [...mods].reverse()) {
    if (md.kind === "inv") { g = `${g}.inverse()`; continue; }
    for (let i = 0; i < md.k; i++) bits.unshift(md.kind === "ctrl" ? 1 : 0);
    const state = bits.slice(0, md.k).reduce((acc, b, i) => acc | (b << i), 0);
    g = `${g}.control(${md.k}, ctrl_state=${state})`;
  }
  const qs = args(qubitText).map(ctx.qubit);
  return [`${ctx.indent}${target}.append(${g}, [${qs.join(", ")}])`];
}

export function qiskitPython(n: number, tape: Entry[], nc = n): string {
  const qasm = exportQasm3(n, tape, nc);
  const symbols = new Set([...qasm.matchAll(/^input float (\w+);$/gm)].map((m) => m[1]));
  const out: string[] = [
    "# Quantum Calculator One (QC-1) circuit for Qiskit (qiskit >= 1.0).",
    "import math",
    "from math import pi",
    "from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister",
    "from qiskit.circuit import Parameter, ParameterExpression",
    `from qiskit.circuit.library import ${[...new Set(Object.values(STD))].sort().join(", ")}`,
    "",
    "",
    "def _fn(expr_method, number_fn):",
    "    def f(x):",
    "        return getattr(x, expr_method)() if isinstance(x, ParameterExpression) else number_fn(x)",
    "    return f",
    "",
    "",
    ...FUNCS.map((f) => {
      const method = ({ ln: "log", asin: "arcsin", acos: "arccos", atan: "arctan" } as Record<string, string>)[f] ?? f;
      const num = f === "ln" ? "math.log" : `math.${f}`;
      return `_${f} = _fn(${JSON.stringify(method)}, ${num})`;
    }),
    "",
  ];
  const body: string[] = [];
  let qreg = 0, creg = 0;
  for (const raw of qasm.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("OPENQASM") || line.startsWith("include")) continue;
    let m: RegExpExecArray | null;
    if ((m = /^gate\s+(\w+)\s*(?:\(([^)]*)\))?\s+([^{]+)\{(.*)\}$/.exec(line))) {
      const [, name, ps, qs, stmts] = m;
      const params = ps ? args(ps) : [];
      const formal = args(qs);
      // qc1_ prefix: Qiskit's .control() maps a gate whose *name* is a standard one (rzx, ecr…) to that gate's definition.
      out.push(`def _gate_${name}(${params.join(", ")}):`, `    sub = QuantumCircuit(${formal.length}, name=${JSON.stringify(`qc1_${name}`)})`);
      for (const st of stmts.split(";").map((x) => x.trim()).filter(Boolean)) {
        const gp = /^gphase\((.*)\)$/.exec(st);
        if (gp) { out.push(`    sub.global_phase += ${pyExpr(gp[1], new Set())}`); continue; }
        out.push(...gateLine(st, "sub", { indent: "    ", qubit: (r) => String(formal.indexOf(r)), symbols: new Set() }));
      }
      out.push("    return sub.to_gate()", "", "");
      continue;
    }
    if ((m = /^input\s+float\s+(\w+);$/.exec(line))) {
      body.push(`${pyName(m[1])} = Parameter(${JSON.stringify(m[1] === "t_" ? "t" : m[1])})`);
      continue;
    }
    if ((m = /^qubit\[(\d+)\]\s+q;$/.exec(line))) { qreg = Number(m[1]); continue; }
    if ((m = /^bit\[(\d+)\]\s+c;$/.exec(line))) { creg = Number(m[1]); continue; }
    // A statement, possibly under `if (c[k] == true|false)`.
    let stmt = line.replace(/;$/, "");
    let indent = "";
    const cond = /^if \(c\[(\d+)\] == (true|false)\)\s+(.*)$/.exec(stmt);
    if (cond) {
      body.push(`with qc.if_test((cr[${cond[1]}], ${cond[2] === "true" ? 1 : 0})):`);
      indent = "    ";
      stmt = cond[3];
    }
    const qref = (r: string) => {
      const x = /^q\[(\d+)\]$/.exec(r);
      if (!x) throw new Error(`qubit ${r}`);
      return `qr[${x[1]}]`;
    };
    if ((m = /^c\[(\d+)\]\s*=\s*measure\s+q\[(\d+)\]$/.exec(stmt))) { body.push(`${indent}qc.measure(qr[${m[2]}], cr[${m[1]}])`); continue; }
    if ((m = /^reset\s+q\[(\d+)\]$/.exec(stmt))) { body.push(`${indent}qc.reset(qr[${m[1]}])`); continue; }
    body.push(...gateLine(stmt, "qc", { indent, qubit: qref, symbols }));
  }
  out.push(`qr = QuantumRegister(${qreg}, "q")`);
  out.push(creg ? `cr = ClassicalRegister(${creg}, "c")` : "");
  out.push(creg ? "qc = QuantumCircuit(qr, cr)" : "qc = QuantumCircuit(qr)");
  out.push(...body.filter((l) => l.includes("Parameter(")));
  out.push(...body.filter((l) => !l.includes("Parameter(")));
  out.push("", "# Qiskit is little-endian: qc's qubit 0 is QC-1's q0, printed rightmost in bitstrings.", "");
  return out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}
