import type { PlacedGate } from "../sim/types";
import { CUSTOM_PREFIX, customOf, expandCustom } from "./custom";
import { applyKQubit } from "../sim/apply";
import { buildMatrix, controlled, M_H, M_S, M_Sdg, M_U, M_X, type Matrix } from "../sim/matrices";
import { measureX, measureY, measureZ } from "../sim/measure";
import { compileExpr } from "../sim/expr";

/**
 * One gate application on the tape. It's a Quantiom-compatible PlacedGate
 * (`column` = tape position) plus the recorded outcome of a measurement, so
 * replaying the tape (undo, resize, reload) reproduces the same collapse.
 *
 * Controls are always expressed through `controls` on a *base* gate id
 * (`x` + one control, never `cx`); the engine wraps the base matrix with
 * `controlled()`.
 */
export type Step = PlacedGate & { outcome?: 0 | 1 };

/** One key press worth of steps; undo/redo work in these units. */
export type Entry = Step[];

export const MEASURE_IDS = new Set(["measure", "measure_x", "measure_y", "reset"]);

/**
 * State preparation = reset (a recorded Z measurement, X on 1) followed by
 * a fixed basis change — the same meaning Quantiom's QASM export gives them.
 */
export const PREP: Record<string, Matrix[]> = {
  init0: [],
  init1: [M_X],
  initplus: [M_H],
  initminus: [M_X, M_H],
  initiplus: [M_H, M_S],
  initiminus: [M_H, M_Sdg],
};

/** Gates that can't take controls: measurements, reset, state prep. */
export const NONUNITARY = new Set([...MEASURE_IDS, ...Object.keys(PREP), "initialize"]);

/**
 * `initialize` stores Quantiom's amplitude tuple "(Re α, Im α, Re β, Im β)".
 * It prepares α|0⟩ + β|1⟩ as U(θ, φ, 0)|0⟩ after a reset, i.e. normalised
 * with α's phase removed (a global phase), so the simulator and the QASM
 * export (reset; U(θ, φ, 0)) agree exactly.
 */
export function initAngles(tuple: string): { theta: number; phi: number } {
  const v = tuple.replace(/[()]/g, "").split(",").map((x) => evalParam(x.trim()));
  if (v.length !== 4 || v.some((x) => !Number.isFinite(x))) throw new Error("bad amplitudes");
  const a = Math.hypot(v[0], v[1]);
  const b = Math.hypot(v[2], v[3]);
  if (a + b < 1e-12) throw new Error("zero state");
  return { theta: 2 * Math.atan2(b, a), phi: Math.atan2(v[3], v[2]) - Math.atan2(v[1], v[0]) };
}

/**
 * Gates defined as sequences of other gates, on local qubits 0..k−1 (last is
 * the target). Quantiom's matrices for these are plain Toffolis ("relative
 * phase ignored"); QC-1 uses the standard definitions (as in Qiskit) so the
 * relative phases are real and the QASM export matches the simulation.
 * Each item: [gate, local controls, local targets].
 */
export const MACROS: Record<string, [string, number[], number[]][]> = {
  rccx: [
    ["h", [], [2]], ["t", [], [2]], ["x", [1], [2]], ["tdg", [], [2]], ["x", [0], [2]],
    ["t", [], [2]], ["x", [1], [2]], ["tdg", [], [2]], ["h", [], [2]],
  ],
  rcccx: [
    ["h", [], [3]], ["t", [], [3]], ["x", [2], [3]], ["tdg", [], [3]], ["h", [], [3]],
    ["x", [0], [3]], ["t", [], [3]], ["x", [1], [3]], ["tdg", [], [3]], ["x", [0], [3]],
    ["t", [], [3]], ["x", [1], [3]], ["tdg", [], [3]], ["h", [], [3]], ["t", [], [3]],
    ["x", [2], [3]], ["tdg", [], [3]], ["h", [], [3]],
  ],
};

const EXPR_CACHE = new Map<string, ReturnType<typeof compileExpr>>();

/** Symbol values by ASCII name (θ → "theta", t → "t"; see sim/expr.ts). */
export type Scope = Record<string, number>;

function compiled(src: string) {
  let c = EXPR_CACHE.get(src);
  if (!c) {
    c = compileExpr(src);
    EXPR_CACHE.set(src, c);
    if (EXPR_CACHE.size > 4096) EXPR_CACHE.delete(EXPR_CACHE.keys().next().value!);
  }
  return c;
}

/**
 * Evaluate an angle expression. NaN on a syntax error or when it uses a
 * symbol that `scope` doesn't define.
 */
export function evalParam(src: string, scope: Scope = {}): number {
  const c = compiled(src);
  for (const v of c.freeVars) if (!(v in scope)) return NaN;
  return c.eval(scope);
}

/** Symbols (ASCII names) an expression uses. */
export function symbolsOf(src: string): string[] {
  return compiled(src).freeVars;
}

/** Symbols a step uses, including those inside a custom gate's definition. */
export function stepSymbols(s: Step): string[] {
  const def = customOf(s.gateId);
  return def ? def.tape.flat().flatMap(stepSymbols) : s.params.flatMap(symbolsOf);
}

/** True when the expression parses (symbols allowed). */
export function exprOk(src: string): boolean {
  return !Number.isNaN(compiled(src).eval({}));
}

/** An RNG that makes measureZ return `o` (it tests `rng() < p1`). */
const forced = (o: 0 | 1) => () => (o === 1 ? -1 : 2);

/**
 * Apply one step to the state in place. Measurements sample with `rng` the
 * first time and record the outcome; later replays force that outcome.
 */
export function applyStep(state: Float64Array, n: number, s: Step, rng: () => number, scope: Scope = {}): Step {
  const prep = s.gateId === "initialize" ? [initMatrix(s.params[0])] : PREP[s.gateId];
  if (prep) {
    const done = applyStep(state, n, { ...s, gateId: "reset" }, rng, scope);
    for (const U of prep) applyKQubit(state, n, s.targets, U);
    return done.outcome === s.outcome ? s : { ...s, outcome: done.outcome };
  }

  const custom = customOf(s.gateId);
  if (custom) {
    for (const d of expandCustom(s, custom)) applyStep(state, n, d, rng, scope);
    return s;
  }
  if (s.gateId.startsWith(CUSTOM_PREFIX)) throw new Error(`gate ${s.gateId.slice(CUSTOM_PREFIX.length)} isn't defined`);

  const macro = MACROS[s.gateId];
  if (macro) {
    for (const [g, cs, ts] of macro) {
      applyStep(state, n, {
        ...s,
        gateId: g,
        controls: [...s.controls, ...cs.map((q) => s.targets[q])],
        controlStates: s.controlStates && [...s.controlStates, ...cs.map(() => true)],
        targets: ts.map((q) => s.targets[q]),
        params: [],
      }, rng, scope);
    }
    return s;
  }

  if (MEASURE_IDS.has(s.gateId)) {
    const q = s.targets[0];
    const measure = (r: () => number) => {
      switch (s.gateId) {
        case "measure_x": return measureX(state, n, q, r);
        case "measure_y": return measureY(state, n, q, r);
        default: return measureZ(state, n, q, r);
      }
    };
    let o: number;
    if (s.outcome === undefined) {
      o = measure(rng);
    } else {
      // Replay forces the recorded outcome, unless changed parameters made it
      // impossible: then sample afresh (the caller sees the new outcome).
      const before = state.slice();
      o = measure(forced(s.outcome));
      let norm = 0;
      for (let i = 0; i < state.length; i++) norm += state[i] * state[i];
      if (norm < 1e-12) {
        state.set(before);
        o = measure(rng);
      }
    }
    if (s.gateId === "reset" && o === 1) applyKQubit(state, n, [q], M_X);
    return o === s.outcome ? s : { ...s, outcome: o as 0 | 1 };
  }

  const params = s.params.map((p) => evalParam(p, scope));
  if (params.some(Number.isNaN)) throw new Error(`undefined symbol in ${s.params.join(", ")}`);
  let U = buildMatrix(s.gateId, params);
  if (!U) throw new Error(`unknown gate ${s.gateId}`);
  if (s.targets.length === 1) {
    applyControlled1(state, n, s.controls, s.controlStates, s.targets[0], U);
    return s;
  }
  if (s.controls.length > 0) U = controlled(U, s.controls.length);

  const anti: number[] = [];
  s.controlStates?.forEach((on, i) => { if (!on) anti.push(s.controls[i]); });
  for (const q of anti) applyKQubit(state, n, [q], M_X);
  applyKQubit(state, n, [...s.controls, ...s.targets], U);
  for (const q of anti) applyKQubit(state, n, [q], M_X);
  return s;
}

/**
 * Fast path for the common case: a 2×2 gate on one target with any number
 * of controls / anti-controls. One pass over amplitude pairs; controls are a
 * bit-mask test rather than a bigger matrix. ~10× faster than the generic
 * applyKQubit at n = 20.
 */
export function applyControlled1(
  state: Float64Array,
  n: number,
  controls: number[],
  controlStates: boolean[] | undefined,
  target: number,
  U: Matrix,
): void {
  const tmask = 1 << (n - 1 - target);
  let cmask = 0;
  let cwant = 0;
  controls.forEach((q, i) => {
    const b = 1 << (n - 1 - q);
    cmask |= b;
    if (controlStates?.[i] !== false) cwant |= b;
  });
  const [[a, b], [c, d]] = U;
  const [ar, ai] = a, [br, bi] = b, [cr, ci] = c, [dr, di] = d;
  const dim = 1 << n;
  for (let i = 0; i < dim; i++) {
    if (i & tmask || (i & cmask) !== cwant) continue;
    const j = i | tmask;
    const xr = state[2 * i], xi = state[2 * i + 1];
    const yr = state[2 * j], yi = state[2 * j + 1];
    state[2 * i] = ar * xr - ai * xi + br * yr - bi * yi;
    state[2 * i + 1] = ar * xi + ai * xr + br * yi + bi * yr;
    state[2 * j] = cr * xr - ci * xi + dr * yr - di * yi;
    state[2 * j + 1] = cr * xi + ci * xr + dr * yi + di * yr;
  }
}

function initMatrix(tuple: string): Matrix {
  const { theta, phi } = initAngles(tuple);
  return M_U(theta, phi, 0);
}

const LABEL: Record<string, string> = {
  i: "I", x: "X", y: "Y", z: "Z", h: "H", s: "S", sdg: "S†", t: "T", tdg: "T†",
  sx: "√X", sxdg: "√X†", sy: "√Y", sydg: "√Y†", p: "P", rx: "RX", ry: "RY", rz: "RZ", u: "U",
  swap: "SWAP", iswap: "iSWAP", rxx: "RXX", ryy: "RYY", rzz: "RZZ",
  measure: "M", measure_x: "MX", measure_y: "MY", reset: "RST",
  r: "R", gpi: "GPI", gpi2: "GPI2",
  dcx: "DCX", ecr: "ECR", sqrtswap: "√SWAP", sqrtswapdg: "√SWAP†", rzx: "RZX",
  fsim: "fSim", xx_plus_yy: "XX+YY", xx_minus_yy: "XX−YY", ms: "MS",
  rccx: "RCCX", rcccx: "RC3X",
  init0: "|0⟩", init1: "|1⟩", initplus: "|+⟩", initminus: "|−⟩", initiplus: "|+i⟩", initiminus: "|−i⟩",
  initialize: "|ψ⟩",
};

/** Pretty-print an expression the way it was keyed in (π/4, 3π/4, √(2)). */
export function prettyExpr(e: string): string {
  return e
    .replace(/(\d|\)|π)\*(π|t\b|[θφλαβγδτω]|sin\(|cos\(|exp\(|sqrt\()/g, "$1$2")
    .replace(/(\d|\))\*π/g, "$1π")
    .replace(/(\d|\)|π)\*\(/g, "$1(")
    .replace(/sqrt\(/g, "√(")
    .replace(/\*/g, "×")
    .replace(/\//g, "÷")
    .replace(/-/g, "−");
}

/** Short tape label: "H q0", "CX q0→q2", "RZ(π÷4) q1", "M q1=0". */
export function formatStep(s: Step): string {
  const base = LABEL[s.gateId] ?? (s.gateId.startsWith(CUSTOM_PREFIX) ? s.gateId.slice(CUSTOM_PREFIX.length) : s.gateId.toUpperCase());
  const cs = s.controls.map((_, i) => (s.controlStates?.[i] === false ? "○" : "C")).join("");
  const args = s.gateId === "initialize"
    ? `(${s.params[0].replace(/[()\s]/g, "").split(",").map((x) => String(+(+x).toFixed(3))).join(",")})`.replace(/-/g, "−")
    : s.params.length ? `(${s.params.map(prettyExpr).join(",")})` : "";
  const ctrl = s.controls.length ? s.controls.map((q) => `q${q}`).join(",") + "→" : "";
  const tgt = s.targets.map((q) => `q${q}`).join(",");
  const out = s.outcome !== undefined && MEASURE_IDS.has(s.gateId) && s.gateId !== "reset" ? `=${s.outcome}` : "";
  return `${cs}${base}${args} ${ctrl}${tgt}${out}`;
}

export function formatEntry(e: Entry): string {
  if (e.length > 1 && e.every((s) => s.gateId === e[0].gateId && s.controls.length === 0 && !MEASURE_IDS.has(s.gateId))) {
    const one = formatStep({ ...e[0], targets: [] }).trim();
    return `${one} ALL`;
  }
  return e.map(formatStep).join(" ");
}
