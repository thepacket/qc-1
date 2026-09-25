import type { Circuit, PlacedGate } from "../sim/types";
import { bitCount, evalParam, initAngles, MACROS, measuredBit, MEASURE_IDS, stepSymbols, symbolsOf, type Entry } from "../calc/steps";
import { customOf, type CustomGate } from "../calc/custom";
import { emitQasm3 } from "./emit";
import { NAMED } from "../calc/lower";

/**
 * Tape → OpenQASM 3.
 *
 * The tape stores controls on base gate ids (`x` + 1 control). The ported
 * emitter expects the named forms, so controlled gates with a stdgates.inc
 * name are renamed (cx, ccx, crz, cp, cswap…); the rest go out as
 * `ctrl @` / `negctrl @` modifier chains.
 *
 * The emitter also uses names that aren't in stdgates.inc (sy, iswap, rzz,
 * fsim, ms, …). Exact definitions for those — global phase included, so
 * controlled versions stay correct — are added to the program when used,
 * so the file loads in any OpenQASM 3 toolchain.
 */


/** Macro gates (rccx, rcccx) written out from the same sequence the simulator runs. */
function macroDefinition(name: string): string {
  const q = "abcd";
  const body = MACROS[name].map(([g, cs, ts]) =>
    cs.length ? `c${g} ${[...cs, ...ts].map((i) => q[i]).join(", ")};` : `${g} ${q[ts[0]]};`,
  );
  const k = Math.max(...MACROS[name].flatMap(([, cs, ts]) => [...cs, ...ts])) + 1;
  return `gate ${name} ${q.slice(0, k).split("").join(", ")} { ${body.join(" ")} }`;
}

/**
 * Definitions for emitted names outside stdgates.inc (exact, global phase
 * included). Parameters are named p0, p1, p2 because Qiskit's importer binds
 * custom-gate parameters in alphabetical order rather than declared order.
 */
export const DEFINITIONS: Record<string, string> = {
  sxdg: "gate sxdg a { inv @ sx a; }",
  sy: "gate sy a { gphase(pi/4); ry(pi/2) a; }",
  sydg: "gate sydg a { gphase(-pi/4); ry(-pi/2) a; }",
  r: "gate r(p0, p1) a { p(-p1) a; rx(p0) a; p(p1) a; }",
  gpi: "gate gpi(p0) a { p(-p0) a; x a; p(p0) a; }",
  gpi2: "gate gpi2(p0) a { p(-p0) a; rx(pi/2) a; p(p0) a; }",
  iswap: "gate iswap a, b { s a; s b; h a; cx a, b; cx b, a; h b; }",
  // Quantiom's DCX and ECR act with the qubit roles the other way round from
  // Qiskit's gates of the same name; these follow the simulator's matrices.
  dcx: "gate dcx a, b { cx a, b; cx b, a; }",
  rxx: "gate rxx(p0) a, b { h a; h b; cx a, b; rz(p0) b; cx a, b; h a; h b; }",
  ryy: "gate ryy(p0) a, b { rx(pi/2) a; rx(pi/2) b; cx a, b; rz(p0) b; cx a, b; rx(-pi/2) a; rx(-pi/2) b; }",
  rzz: "gate rzz(p0) a, b { cx a, b; rz(p0) b; cx a, b; }",
  rzx: "gate rzx(p0) a, b { h b; cx a, b; rz(p0) b; cx a, b; h b; }",
  ecr: "gate ecr a, b { rzx(pi/4) a, b; x a; rzx(-pi/4) a, b; }",
  sqrtswap: "gate sqrtswap a, b { cx b, a; ctrl @ sx a, b; cx b, a; }",
  sqrtswapdg: "gate sqrtswapdg a, b { inv @ sqrtswap a, b; }",
  fsim: "gate fsim(p0, p1) a, b { rxx(p0) a, b; ryy(p0) a, b; cp(-p1) a, b; }",
  xx_plus_yy: "gate xx_plus_yy(p0, p1) a, b { rz(-p1) a; rxx(p0/2) a, b; ryy(p0/2) a, b; rz(p1) a; }",
  xx_minus_yy: "gate xx_minus_yy(p0, p1) a, b { rz(-p1) b; rxx(p0/2) a, b; ryy(-p0/2) a, b; rz(p1) b; }",
  ms: "gate ms(p0, p1, p2) a, b { p(-p0) a; p(-p1) b; rxx(p2) a, b; p(p0) a; p(p1) b; }",
  rccx: macroDefinition("rccx"),
  rcccx: macroDefinition("rcccx"),
};

/** Definitions that use other non-stdgates; those are emitted first. */
const DEPENDS: Record<string, string[]> = {
  ecr: ["rzx"],
  sqrtswapdg: ["sqrtswap"],
  fsim: ["rxx", "ryy"],
  xx_plus_yy: ["rxx", "ryy"],
  xx_minus_yy: ["rxx", "ryy"],
  ms: ["rxx"],
};

function definitionsFor(used: Set<string>): string[] {
  const out: string[] = [];
  const add = (g: string) => {
    if (!(g in DEFINITIONS) || out.includes(DEFINITIONS[g])) return;
    for (const d of DEPENDS[g] ?? []) add(d);
    out.push(DEFINITIONS[g]);
  };
  for (const g of Object.keys(DEFINITIONS)) if (used.has(g)) add(g);
  return out;
}

/**
 * The QASM identifier for a QC-1 symbol. `t` names the T gate in
 * stdgates.inc, so the symbol t is exported as `t_`; Greek symbols use their
 * ASCII names (θ → theta), as the emitter writes them.
 */
export const qasmSymbol = (name: string) => (name === "t" ? "t_" : name);

/**
 * A gate parameter for export. Numeric expressions stay symbolic in π
 * (3*π/4 → 3*pi/4) and fold to a double when they use a function (sqrt…),
 * which Qiskit's importer can't evaluate. Expressions with symbols are kept,
 * with t renamed (see qasmSymbol); functions *of* symbols stay as written:
 * valid OpenQASM 3, but not loadable by qiskit-qasm3-import 0.6.
 */
export function qasmParam(expr: string): string {
  if (symbolsOf(expr).length > 0) return floatLiterals(expr.replace(/\bt\b/g, "t_"));
  return floatLiterals(/[a-z]/i.test(expr) ? String(evalParam(expr)) : expr);
}

/**
 * Make every division's numerator a float. In OpenQASM 3 an integer divided
 * by an integer is integer division, so `rz(1/2)` would import as rz(0) and
 * `2/3*pi` as 0. An integer literal right before `/` becomes `1.0`; a
 * parenthesised numerator gets its integer literals floated.
 */
function floatLiterals(expr: string): string {
  const float = new Set<number>(); // start index of integer literals to float
  const intAt = (end: number): number | null => {
    // An integer literal ending at `end` (inclusive)? Return its start.
    let k = end;
    while (k >= 0 && /\d/.test(expr[k])) k--;
    if (k === end || expr[k] === "." || /[eE]/.test(expr[k] ?? "") || /[\w.]/.test(expr[k] ?? "")) return null;
    return k + 1;
  };
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] !== "/") continue;
    let k = i - 1;
    while (k >= 0 && expr[k] === " ") k--;
    if (expr[k] === ")") {
      let depth = 0, open = k;
      for (; open >= 0; open--) {
        if (expr[open] === ")") depth++;
        else if (expr[open] === "(" && --depth === 0) break;
      }
      for (let m = open + 1; m < k; m++) {
        if (/\d/.test(expr[m]) && !/[\w.]/.test(expr[m - 1] ?? "")) {
          let e = m;
          while (/\d/.test(expr[e + 1] ?? "")) e++;
          if (intAt(e) === m && !/[.eE\d]/.test(expr[e + 1] ?? "")) float.add(m);
          m = e;
        }
      }
    } else {
      const start = intAt(k);
      if (start !== null) float.add(start);
    }
  }
  let out = "";
  for (let i = 0; i < expr.length; i++) {
    out += expr[i];
    if ([...float].some((st) => {
      let e = st;
      while (/\d/.test(expr[e + 1] ?? "")) e++;
      return e === i;
    })) out += ".0";
  }
  return out;
}

/**
 * A 2×2 unitary as e^{iα}·U(θ, φ, λ) (OpenQASM's U), from u_arb's eight
 * numbers (Re, Im of each cell, row-major). Exact up to rounding.
 */
export function zyz(p: number[]): { theta: number; phi: number; lambda: number; alpha: number } {
  const [ar, ai, br, bi, cr, ci, dr, di] = p;
  const a = Math.hypot(ar, ai), c = Math.hypot(cr, ci);
  const theta = 2 * Math.atan2(c, a);
  const arg = (re: number, im: number) => Math.atan2(im, re);
  if (a > 1e-12) {
    // M00 = e^{iα} cos, M10 = e^{i(α+φ)} sin, M01 = −e^{i(α+λ)} sin, M11 = e^{i(α+φ+λ)} cos
    const alpha = arg(ar, ai);
    const phi = c > 1e-12 ? arg(cr, ci) - alpha : 0;
    const lambda = c > 1e-12 ? arg(-br, -bi) - alpha : arg(dr, di) - alpha - phi;
    return { theta, phi, lambda, alpha };
  }
  // θ = π: only the off-diagonal is set; take λ = 0.
  const alpha = arg(-br, -bi);
  return { theta, phi: arg(cr, ci) - alpha, lambda: 0, alpha };
}

/** File-local gate definitions for u_arb matrices (one per distinct matrix). */
function uarbDefinitions(tape: Entry[]): Map<string, { name: string; def: string }> {
  const out = new Map<string, { name: string; def: string }>();
  for (const s of tape.flat()) {
    if (s.gateId !== "u_arb") continue;
    const key = s.params.join(",");
    if (out.has(key)) continue;
    const v = s.params.map((x) => evalParam(x));
    if (v.length !== 8 || v.some((x) => !Number.isFinite(x))) continue;
    const { theta, phi, lambda, alpha } = zyz(v);
    const name = `uarb${out.size}`;
    const phase = Math.abs(alpha) > 1e-15 ? ` gphase(${alpha});` : "";
    out.set(key, { name, def: `gate ${name} a { U(${theta}, ${phi}, ${lambda}) a;${phase} }` });
  }
  return out;
}

/** Symbols of a custom gate, in parameter order (p0, p1, … bind alphabetically in Qiskit). */
const customParams = (def: CustomGate) => [...new Set(def.tape.flat().flatMap(stepSymbols))].sort();

/**
 * Parameter i of a gate with `count` parameters: p0…p9, or zero-padded
 * (p00…p11) from 11 on, because Qiskit's importer binds a definition's
 * parameters in alphabetical order and p10 would come before p2.
 */
const pName = (i: number, count: number) => `p${String(i).padStart(String(count - 1).length, "0")}`;

/**
 * The tape as an emitter Circuit. A measurement writes its bit (`c[k] =
 * measure q[i]`, k = `measuredBit`: its own, else c[i]); a conditional step
 * becomes `if (c[k] == v) …`. With any classical step, `bit[m] c` declares
 * `nc` bits, or more if the tape names more.
 */
export function tapeToCircuit(n: number, tape: Entry[], uarb = uarbDefinitions(tape), nc = n): Circuit {
  const gates: PlacedGate[] = [];
  let classical = false;
  tape.forEach((entry, column) => {
    for (const s of entry) {
      const cond = s.condition ? { condition: { ...s.condition } } : {};
      if (s.condition) classical = true;
      if (s.gateId === "initialize") {
        // reset; U(θ, φ, 0) — exactly what the simulator does.
        const { theta, phi } = initAngles(s.params[0]);
        const base = { column, controls: [], targets: s.targets, clbits: [], ...cond };
        gates.push({ ...base, id: `${s.id}a`, gateId: "reset", params: [], ...(s.outcome !== undefined ? { annotation: `QC-1 measured ${s.outcome}` } : {}) });
        gates.push({ ...base, id: `${s.id}b`, gateId: "u", params: [String(theta), String(phi), "0"] });
        continue;
      }
      const custom = customOf(s.gateId);
      if (custom) {
        gates.push({
          id: s.id, gateId: `def:${custom.name}`, column, controls: s.controls, targets: s.targets, clbits: [],
          params: customParams(custom).map(qasmSymbol),
          ...(s.controlStates ? { controlStates: s.controlStates } : {}), ...cond,
        });
        continue;
      }
      const arb = s.gateId === "u_arb" ? uarb.get(s.params.join(",")) : undefined;
      if (arb) {
        gates.push({
          id: s.id, gateId: `def:${arb.name}`, column, controls: s.controls, targets: s.targets, clbits: [], params: [],
          ...(s.controlStates ? { controlStates: s.controlStates } : {}), ...cond,
        });
        continue;
      }
      const measures = MEASURE_IDS.has(s.gateId) && s.gateId !== "reset";
      if (measures) classical = true;
      const g: PlacedGate = {
        id: s.id,
        gateId: NAMED[s.gateId]?.[s.controls.length] ?? s.gateId,
        column,
        controls: s.controls,
        targets: s.targets,
        clbits: measures ? [measuredBit(s)] : [],
        params: s.params.map(qasmParam),
        ...(s.controlStates ? { controlStates: s.controlStates } : {}), ...cond,
      };
      // Measurements, resets and preps (which start with a reset) record their outcome.
      if (s.outcome !== undefined) g.annotation = `QC-1 measured ${s.outcome}`;
      gates.push(g);
    }
  });
  return { numQubits: n, numClbits: classical ? bitCount(n, tape, nc) : 0, gates };
}

/** Custom gates a tape uses, dependencies first. */
function customsUsed(tape: Entry[], out: CustomGate[] = []): CustomGate[] {
  for (const s of tape.flat()) {
    const def = customOf(s.gateId);
    if (!def || out.includes(def)) continue;
    customsUsed(def.tape, out);
    out.push(def);
  }
  return out;
}

/** The statements of a tape as a gate body: q[j] → a{j}, symbols → p{i}. */
function gateBody(def: CustomGate, uarb: ReturnType<typeof uarbDefinitions>): string {
  const lines = emitQasm3(tapeToCircuit(def.k, def.tape, uarb)).split("\n");
  const start = lines.findIndex((l) => /^qubit\[\d+\] q;$/.test(l)) + 1;
  const params = customParams(def).map(qasmSymbol);
  return lines.slice(start).filter((l) => l.trim() && !l.startsWith("//") && !l.startsWith("input float"))
    .map((l) => params.reduce((acc, v, i) => acc.replace(new RegExp(`\\b${v}\\b`, "g"), pName(i, params.length)), l.replace(/q\[(\d+)\]/g, "a$1")))
    .join(" ");
}

/** OpenQASM 3 of the tape; `nc` classical bits are declared (default: one per qubit) when it measures or reads any. */
export function exportQasm3(n: number, tape: Entry[], nc = n): string {
  const customs = customsUsed(tape);
  const all = [...tape, ...customs.flatMap((d) => d.tape)];
  const uarb = uarbDefinitions(all);
  const circuit = tapeToCircuit(n, tape, uarb, nc);
  const inner = customs.flatMap((d) => tapeToCircuit(d.k, d.tape, uarb).gates.map((g) => g.gateId));
  const defs = [
    ...definitionsFor(new Set([...circuit.gates.map((g) => g.gateId), ...inner])),
    ...[...uarb.values()].map((d) => d.def),
    ...customs.map((d) => {
      const ps = customParams(d);
      const qs = Array.from({ length: d.k }, (_, j) => `a${j}`).join(", ");
      return `gate ${d.name}${ps.length ? `(${ps.map((_, i) => pName(i, ps.length)).join(", ")})` : ""} ${qs} { ${gateBody(d, uarb)} }`;
    }),
  ];
  // The emitter declares only a fixed list of Greek names; declare every
  // symbol the tape uses instead (t included, as t_).
  const syms = [...new Set(tape.flatMap((e) => e.flatMap(stepSymbols)))].sort().map(qasmSymbol);
  const lines = emitQasm3(circuit).split("\n").filter((l) => !l.startsWith("input float "));
  const at = lines.findIndex((l) => l.startsWith("include")) + 1;
  const decls = syms.map((v) => `input float ${v};`);
  lines.splice(at, 0, ...(defs.length ? ["", ...defs] : []), ...(decls.length ? ["", ...decls] : []));
  const steps = tape.length === 1 ? "1 step" : `${tape.length} steps`;
  return [`// Quantum Calculator One (QC-1) circuit, ${steps}`, ...lines].join("\n") + "\n";
}
