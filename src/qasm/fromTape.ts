import type { Circuit, PlacedGate } from "../sim/types";
import { evalParam, initAngles, MACROS, MEASURE_IDS, symbolsOf, type Entry } from "../calc/steps";
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
  dcx: "gate dcx a, b { cx b, a; cx a, b; }",
  rxx: "gate rxx(p0) a, b { h a; h b; cx a, b; rz(p0) b; cx a, b; h a; h b; }",
  ryy: "gate ryy(p0) a, b { rx(pi/2) a; rx(pi/2) b; cx a, b; rz(p0) b; cx a, b; rx(-pi/2) a; rx(-pi/2) b; }",
  rzz: "gate rzz(p0) a, b { cx a, b; rz(p0) b; cx a, b; }",
  rzx: "gate rzx(p0) a, b { h b; cx a, b; rz(p0) b; cx a, b; h b; }",
  ecr: "gate ecr a, b { rzx(pi/4) b, a; x b; rzx(-pi/4) b, a; }",
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
  if (symbolsOf(expr).length > 0) return expr.replace(/\bt\b/g, "t_");
  return /[a-z]/i.test(expr) ? String(evalParam(expr)) : expr;
}

export function tapeToCircuit(n: number, tape: Entry[]): Circuit {
  const gates: PlacedGate[] = [];
  let clbit = 0;
  tape.forEach((entry, column) => {
    for (const s of entry) {
      if (s.gateId === "initialize") {
        // reset; U(θ, φ, 0) — exactly what the simulator does.
        const { theta, phi } = initAngles(s.params[0]);
        const base = { column, controls: [], targets: s.targets, clbits: [] };
        gates.push({ ...base, id: `${s.id}a`, gateId: "reset", params: [] });
        gates.push({ ...base, id: `${s.id}b`, gateId: "u", params: [String(theta), String(phi), "0"] });
        continue;
      }
      const g: PlacedGate = {
        id: s.id,
        gateId: NAMED[s.gateId]?.[s.controls.length] ?? s.gateId,
        column,
        controls: s.controls,
        targets: s.targets,
        clbits: s.gateId === "reset" ? [] : MEASURE_IDS.has(s.gateId) ? [clbit++] : [],
        params: s.params.map(qasmParam),
        ...(s.controlStates ? { controlStates: s.controlStates } : {}),
      };
      if (s.outcome !== undefined && MEASURE_IDS.has(s.gateId) && s.gateId !== "reset") g.annotation = `QC-1 measured ${s.outcome}`;
      gates.push(g);
    }
  });
  return { numQubits: n, numClbits: clbit, gates };
}

export function exportQasm3(n: number, tape: Entry[]): string {
  const circuit = tapeToCircuit(n, tape);
  const defs = definitionsFor(new Set(circuit.gates.map((g) => g.gateId)));
  // The emitter declares only a fixed list of Greek names; declare every
  // symbol the tape uses instead (t included, as t_).
  const syms = [...new Set(tape.flatMap((e) => e.flatMap((s) => s.params.flatMap(symbolsOf))))].sort().map(qasmSymbol);
  const lines = emitQasm3(circuit).split("\n").filter((l) => !l.startsWith("input float "));
  const at = lines.findIndex((l) => l.startsWith("include")) + 1;
  const decls = syms.map((v) => `input float ${v};`);
  lines.splice(at, 0, ...(defs.length ? ["", ...defs] : []), ...(decls.length ? ["", ...decls] : []));
  const steps = tape.length === 1 ? "1 step" : `${tape.length} steps`;
  return [`// Quantum Calculator One (QC-1) tape, ${steps}`, ...lines].join("\n") + "\n";
}
