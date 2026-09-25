/**
 * The block library: reusable circuit blocks, each named after an object in
 * Qiskit's circuit library and checked against it exactly, global phase
 * included (validation/ref/g_blocks.py). Bell and GHZ have no Qiskit object:
 * they are QC-1 definitions, checked against their target states.
 *
 * A block is one step on the diagram: a custom gate (NAMEk, all capitals plus
 * the qubit count) defined on first use, whose settings are written into it.
 * Pauli Measurement is the exception: it measures, so it is placed as steps.
 * Parameters are symbols (θ₀, θ₁…, γ₀, β₀…) that PARAM sets.
 *
 * Qubits are local, 0..k−1, in Qiskit's order: local qubit 0 is the least
 * significant bit and the rightmost character of bitstrings and Pauli strings.
 */
import type { Entry, Step } from "./steps";
import type { CustomGate } from "./custom";
import { CUSTOM_PREFIX } from "./custom";
import { diffuser, iqft, qft } from "./blocks";
import { buildTrotterCircuit, parsePauliSum } from "../sim/trotter";
import { raiseCircuit } from "./toolCircuit";
import { internalPauliSum } from "./order";

export type Settings = Record<string, string>;

export type SettingDef = {
  key: string;
  label: string;
  kind: "int" | "choice" | "bool" | "expr" | "symbol" | "pauli" | "bits" | "edges" | "gate";
  /** Default for a block on k qubits. */
  default: (k: number) => string;
  min?: number;
  max?: (k: number) => number;
  options?: [string, string][];
  /** Text presets for a block on k qubits (pauli, edges, bits). */
  presets?: (k: number) => [string, string][];
  hint?: string;
};

export type Family = "prepare" | "fourier" | "search" | "variational" | "dynamics" | "estimate" | "measure";

export const FAMILIES: { id: Family; label: string }[] = [
  { id: "prepare", label: "Prepare" },
  { id: "fourier", label: "Fourier" },
  { id: "search", label: "Search" },
  { id: "variational", label: "Variational" },
  { id: "dynamics", label: "Dynamics" },
  { id: "estimate", label: "Estimate" },
  { id: "measure", label: "Measure" },
];

/** A user gate a block can take (Phase Estimation's operation). */
export type GateLookup = (name: string) => CustomGate | undefined;

export type Built = { gate: CustomGate } | { entries: Entry[] };

export type BlockSpec = {
  id: string;
  /** Title Case, as users see it. */
  name: string;
  /** Short tile label. */
  label: string;
  family: Family;
  /** The exact Qiskit identifier it is checked against, or "" for a QC-1 definition. */
  qiskit: string;
  note: string;
  /** Exported gate names start with this (NAME + k). */
  prefix: string;
  minQubits: number;
  maxQubits?: number;
  settings: SettingDef[];
  /** The block's size when its settings fix it (Pauli Evolution, Phase Estimation, Pauli Measurement). */
  size?: (s: Settings, gates: GateLookup) => number;
  build: (k: number, s: Settings, gates: GateLookup) => Built;
};

let seq = 0;
const step = (gateId: string, targets: number[], controls: number[] = [], params: string[] = [], controlStates?: boolean[]): Step => ({
  id: `bl${seq++}`, gateId, column: 0, targets, controls, clbits: [], params,
  ...(controlStates && controlStates.some((on) => !on) ? { controlStates } : {}),
});
const range = (k: number) => [...Array(k).keys()];
const gate = (name: string, k: number, tape: Entry[]): Built => ({ gate: { name, k, tape } });

/** e^{iα}·I on local qubit 0, exactly, for any α (a symbol too): P(α) X P(α) X. */
export const phaseSteps = (alpha: string): Entry[] =>
  [[step("p", [0], [], [alpha])], [step("x", [0])], [step("p", [0], [], [alpha])], [step("x", [0])]];

// ── Settings parsers (throw with a message for the sheet) ─────────────────

function int(s: Settings, key: string, lo: number, hi: number, label = key): number {
  const v = Number(s[key]);
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${label}: ${lo}–${hi}`);
  return v;
}

/** Marked bitstrings, Qiskit order ("101, 011"): distinct, k bits each. */
export function parseBits(text: string, k: number): string[] {
  const out = [...new Set(text.split(/[\s,;]+/).filter(Boolean))];
  if (!out.length) throw new Error("mark at least one bitstring");
  for (const b of out) if (!/^[01]+$/.test(b) || b.length !== k) throw new Error(`"${b}": ${k} bits of 0 and 1 (q0 rightmost)`);
  if (out.length >= 2 ** k) throw new Error("marking every state does nothing");
  return out;
}

/** Edges "0-1, 1-2" between local qubits 0..k−1, distinct, in order. */
export function parseEdges(text: string, k: number): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d+)-(\d+)$/.exec(part);
    if (!m) throw new Error(`"${part}": write edges as 0-1`);
    const a = Number(m[1]), b = Number(m[2]);
    if (a >= k || b >= k) throw new Error(`"${part}": qubits 0–${k - 1} of the block`);
    if (a === b) throw new Error(`"${part}": an edge joins two qubits`);
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([a, b]);
  }
  if (!out.length) throw new Error("give at least one edge");
  return out;
}

const edgePresets = (k: number): [string, string][] => {
  const line = range(k - 1).map((i) => `${i}-${i + 1}`);
  const out: [string, string][] = [["line", line.join(", ")]];
  if (k >= 3) out.push(["ring", [...line, `${k - 1}-0`].join(", ")]);
  if (k >= 3) out.push(["star", range(k - 1).map((i) => `0-${i + 1}`).join(", ")]);
  if (k >= 3) out.push(["complete", range(k).flatMap((a) => range(k).filter((b) => b > a).map((b) => `${a}-${b}`)).join(", ")]);
  return out;
};

/** Qiskit's entangler maps (n_local), per repetition r. */
export function entanglerPairs(kind: string, k: number, r: number): [number, number][] {
  const linear = range(k - 1).map((i): [number, number] => [i, i + 1]);
  const circular: [number, number][] = k > 2 ? [[k - 1, 0], ...linear] : linear;
  switch (kind) {
    case "full": return range(k).flatMap((a) => range(k).filter((b) => b > a).map((b): [number, number] => [a, b]));
    case "linear": return linear;
    case "reverse_linear": return [...linear].reverse();
    case "pairwise": return [...linear.filter(([a]) => a % 2 === 0), ...linear.filter(([a]) => a % 2 === 1)];
    case "circular": return circular;
    case "sca": {
      const m = circular.length;
      if (!m) return [];
      const start = ((m - r) % m + m) % m;
      const rot = [...circular.slice(start), ...circular.slice(0, start)];
      return r % 2 ? rot.map(([a, b]) => [b, a]) : rot;
    }
    default: throw new Error(`entanglement: ${kind}`);
  }
}

const ENTANGLEMENT: [string, string][] = [
  ["reverse_linear", "reverse linear"], ["linear", "linear"], ["full", "full"], ["circular", "circular"], ["pairwise", "pairwise"], ["sca", "SCA"],
];

const SYMBOLS: [string, string][] = [["theta", "θ"], ["phi", "φ"], ["lambda", "λ"], ["alpha", "α"], ["beta", "β"], ["gamma", "γ"], ["delta", "δ"], ["tau", "τ"], ["omega", "ω"]];

/**
 * Qiskit's n_local with RY (Real Amplitudes) or RY then RZ (Efficient SU(2))
 * rotation layers and CX entanglers; parameters prefix_0, prefix_1… in
 * Qiskit's order (layer by layer, qubit by qubit).
 */
function nLocal(k: number, s: Settings, rots: string[]): Entry[] {
  const reps = int(s, "reps", 1, 20, "repetitions");
  const final = s.final !== "no";
  const prefix = s.prefix || "theta";
  let p = 0;
  const layer = (): Entry[] => rots.map((g) => range(k).map((q) => step(g, [q], [], [`${prefix}_${p++}`])));
  const out: Entry[] = [];
  for (let r = 0; r < reps; r++) {
    out.push(...layer());
    for (const [a, b] of entanglerPairs(s.entanglement || "reverse_linear", k, r)) out.push([step("x", [b], [a])]);
  }
  if (final) out.push(...layer());
  return out;
}

const nLocalSettings: SettingDef[] = [
  { key: "reps", label: "repetitions", kind: "int", default: () => "3", min: 1, max: () => 20 },
  { key: "entanglement", label: "entanglement", kind: "choice", default: () => "reverse_linear", options: ENTANGLEMENT },
  { key: "final", label: "final rotation layer", kind: "bool", default: () => "yes" },
  { key: "prefix", label: "parameters", kind: "symbol", default: () => "theta", options: SYMBOLS },
];

/** Phase flip on each marked bitstring (Qiskit order): a Z with (anti-)controls. */
function oracle(k: number, marked: string[]): Entry[] {
  const out: Entry[] = [];
  const t = k - 1;
  for (const b of marked) {
    const bit = (q: number) => b[k - 1 - q] === "1";
    const flip = !bit(t);
    if (flip) out.push([step("x", [t])]);
    out.push([step("z", [t], range(k - 1), [], range(k - 1).map(bit))]);
    if (flip) out.push([step("x", [t])]);
  }
  return out;
}

const groverDefault = (k: number, marked: number) => Math.max(1, Math.round(Math.PI / 4 * Math.sqrt(2 ** k / marked) - 0.5));

/** Qiskit's UniformSuperpositionGate(M, k) construction (Shukla & Vedula), step by step. */
function uniform(k: number, M: number): Entry[] {
  if ((M & (M - 1)) === 0) return [range(Math.log2(M)).map((q) => step("h", [q]))].filter((e) => e.length);
  const bits = [...M.toString(2)].reverse().map(Number);
  const ones = bits.flatMap((b, i) => (b ? [i] : []));
  const out: Entry[] = [];
  const xs = ones.slice(1).map((q) => step("x", [q]));
  if (xs.length) out.push(xs);
  let current = 2 ** ones[0];
  if (ones[0] > 0) out.push(range(ones[0]).map((q) => step("h", [q])));
  out.push([step("ry", [ones[1]], [], [String(-2 * Math.acos(Math.sqrt(current / M)))])]);
  for (let q = ones[0]; q < ones[1]; q++) out.push([step("h", [q], [ones[1]], [], [false])]);
  for (let m = 1; m < ones.length - 1; m++) {
    const theta = -2 * Math.acos(Math.sqrt(2 ** ones[m] / (M - current)));
    out.push([step("ry", [ones[m + 1]], [ones[m]], [String(theta)], [false])]);
    for (let q = ones[m]; q < ones[m + 1]; q++) out.push([step("h", [q], [ones[m + 1]], [], [false])]);
    current += 2 ** ones[m];
  }
  void k;
  return out;
}

/** Hamiltonian text (Qiskit order) → its terms, with the identity part apart. */
export function hamiltonian(text: string) {
  const terms = parsePauliSum(internalPauliSum(text));
  if (!terms.length) throw new Error("type H as a Pauli sum, e.g. -1*ZZ + -0.5*XI");
  const k = terms[0].paulis.length;
  const identity = terms.filter((t) => /^I+$/.test(t.paulis)).reduce((a, t) => a + t.coefficient, 0);
  return { k, terms, identity };
}

/** A user gate's definition, for Phase Estimation. */
function userGate(s: Settings, gates: GateLookup): CustomGate {
  const g = s.gate ? gates(s.gate) : undefined;
  if (!g) throw new Error("choose the operation (one of your gates: define one, or type a matrix, first)");
  return g;
}

/** Pauli string (Qiskit order) for Pauli Measurement. */
function pauliString(s: Settings): string {
  const p = (s.pauli ?? "").trim().toUpperCase();
  if (!/^[IXYZ]+$/.test(p)) throw new Error("a Pauli string like XZ (q0 rightmost)");
  if (/^I+$/.test(p)) throw new Error("the identity always reads +1");
  return p;
}

export const BLOCKS: BlockSpec[] = [
  {
    id: "bell", name: "Bell Pair", label: "Bell", family: "prepare", qiskit: "", prefix: "BELL", minQubits: 2, maxQubits: 2,
    note: "Maps |00⟩ to a Bell state (QC-1 definition: H and CX, with X or Z for the other three).",
    settings: [{ key: "variant", label: "state", kind: "choice", default: () => "phi+", options: [["phi+", "Φ+"], ["phi-", "Φ−"], ["psi+", "Ψ+"], ["psi-", "Ψ−"]] }],
    build: (k, s) => {
      const v = s.variant || "phi+";
      const tape: Entry[] = [[step("h", [0])]];
      if (v === "phi-") tape.push([step("z", [0])]);
      if (v.startsWith("psi")) tape.push([step("x", [1])]);
      tape.push([step("x", [1], [0])]);
      if (v === "psi-") tape.push([step("z", [1])]);
      return gate(`BELL${k}`, k, tape);
    },
  },
  {
    id: "ghz", name: "GHZ State", label: "GHZ", family: "prepare", qiskit: "", prefix: "GHZ", minQubits: 2,
    note: "Maps |0…0⟩ to (|0…0⟩ + |1…1⟩)/√2: H, then a CX chain (QC-1 definition).",
    settings: [],
    build: (k) => gate(`GHZ${k}`, k, [[step("h", [0])], ...range(k - 1).map((q): Entry => [step("x", [q + 1], [q])])]),
  },
  {
    id: "unif", name: "Uniform Superposition", label: "Uniform", family: "prepare", qiskit: "qiskit.circuit.library.UniformSuperpositionGate", prefix: "UNIF", minQubits: 1,
    note: "Maps |0…0⟩ to an equal superposition of |0⟩…|M−1⟩.",
    settings: [{ key: "M", label: "states M", kind: "int", default: (k) => String(Math.max(2, 2 ** k - 1)), min: 2, max: (k) => 2 ** k }],
    build: (k, s) => gate(`UNIF${k}`, k, uniform(k, int(s, "M", 2, 2 ** k, "M"))),
  },
  {
    id: "graph", name: "Graph State", label: "Graph", family: "prepare", qiskit: "qiskit.circuit.library.GraphStateGate", prefix: "GRAPH", minQubits: 2,
    note: "H on every qubit, then CZ on every edge of the graph.",
    settings: [{ key: "edges", label: "edges", kind: "edges", default: (k) => edgePresets(k)[0][1], presets: edgePresets, hint: "0-1, 1-2" }],
    build: (k, s) => gate(`GRAPH${k}`, k, [range(k).map((q) => step("h", [q])), ...parseEdges(s.edges ?? "", k).map(([a, b]): Entry => [step("z", [b], [a])])]),
  },
  {
    id: "qft", name: "QFT", label: "QFT", family: "fourier", qiskit: "qiskit.circuit.library.QFTGate", prefix: "QFT", minQubits: 1,
    note: "The quantum Fourier transform (the first qubit is the least significant). Other settings: qiskit.synthesis.synth_qft_full.",
    settings: [
      { key: "approx", label: "approximation degree", kind: "int", default: () => "0", min: 0, max: (k) => Math.max(0, k - 1) },
      { key: "swaps", label: "final swaps", kind: "bool", default: () => "yes" },
    ],
    build: (k, s) => gate(`QFT${k}`, k, qft(k, int(s, "approx", 0, Math.max(0, k - 1), "approximation degree"), s.swaps !== "no")),
  },
  {
    id: "iqft", name: "QFT†", label: "QFT†", family: "fourier", qiskit: "qiskit.circuit.library.QFTGate (inverse)", prefix: "IQFT", minQubits: 1,
    note: "The inverse QFT: the read-out of phase estimation.",
    settings: [
      { key: "approx", label: "approximation degree", kind: "int", default: () => "0", min: 0, max: (k) => Math.max(0, k - 1) },
      { key: "swaps", label: "final swaps", kind: "bool", default: () => "yes" },
    ],
    build: (k, s) => gate(`IQFT${k}`, k, iqft(k, int(s, "approx", 0, Math.max(0, k - 1), "approximation degree"), s.swaps !== "no")),
  },
  {
    id: "oracle", name: "Marked-State Oracle", label: "Oracle", family: "search", qiskit: "qiskit.circuit.library.DiagonalGate", prefix: "ORACLE", minQubits: 1,
    note: "Flips the sign of each marked basis state (a diagonal of ±1).",
    settings: [{ key: "marked", label: "marked", kind: "bits", default: (k) => "1".repeat(k), hint: "101, 011 (q0 rightmost)" }],
    build: (k, s) => gate(`ORACLE${k}`, k, oracle(k, parseBits(s.marked ?? "", k))),
  },
  {
    id: "diff", name: "Diffuser", label: "Diffuser", family: "search", qiskit: "", prefix: "DIFF", minQubits: 1,
    note: "2|s⟩⟨s| − I, the reflection about the uniform superposition (Grover's diffusion; checked against its matrix).",
    settings: [],
    build: (k) => gate(`DIFF${k}`, k, diffuser(k)),
  },
  {
    id: "grover", name: "Grover Operator", label: "Grover", family: "search", qiskit: "qiskit.circuit.library.grover_operator", prefix: "GROVER", minQubits: 1,
    note: "Oracle, then diffuser, repeated: Qiskit's grover_operator with the marked-state oracle. Start from H on every qubit.",
    settings: [
      { key: "marked", label: "marked", kind: "bits", default: (k) => "1".repeat(k), hint: "101, 011 (q0 rightmost)" },
      { key: "iterations", label: "iterations", kind: "int", default: (k) => String(groverDefault(k, 1)), min: 1, max: () => 64 },
    ],
    build: (k, s) => {
      const marked = parseBits(s.marked ?? "", k);
      const r = int(s, "iterations", 1, 64);
      const one = [...oracle(k, marked), ...diffuser(k)];
      return gate(`GROVER${k}`, k, range(r).flatMap(() => one));
    },
  },
  {
    id: "realamp", name: "Real Amplitudes", label: "RealAmp", family: "variational", qiskit: "qiskit.circuit.library.real_amplitudes", prefix: "REALAMP", minQubits: 1,
    note: "RY layers and CX entanglers; real amplitudes only. Parameters are symbols: set them in PARAM.",
    settings: nLocalSettings,
    build: (k, s) => gate(`REALAMP${k}`, k, nLocal(k, s, ["ry"])),
  },
  {
    id: "esu2", name: "Efficient SU(2)", label: "SU(2)", family: "variational", qiskit: "qiskit.circuit.library.efficient_su2", prefix: "ESU2", minQubits: 1,
    note: "RY and RZ layers and CX entanglers. Parameters are symbols: set them in PARAM.",
    settings: nLocalSettings,
    build: (k, s) => gate(`ESU2${k}`, k, nLocal(k, s, ["ry", "rz"])),
  },
  {
    id: "qaoa", name: "QAOA Ansatz", label: "QAOA", family: "variational", qiskit: "qiskit.circuit.library.qaoa_ansatz", prefix: "QAOA", minQubits: 2,
    note: "MaxCut on a graph: RZZ(2γₗ) per edge, then RX(2βₗ) per qubit, for each layer l; symbols γ₀, β₀… (set them in PARAM).",
    settings: [
      { key: "edges", label: "graph edges", kind: "edges", default: (k) => edgePresets(k)[k >= 3 ? 1 : 0][1], presets: edgePresets, hint: "0-1, 1-2" },
      { key: "layers", label: "layers p", kind: "int", default: () => "1", min: 1, max: () => 10 },
      { key: "init", label: "initial H layer", kind: "bool", default: () => "yes" },
    ],
    build: (k, s) => {
      const edges = parseEdges(s.edges ?? "", k);
      const p = int(s, "layers", 1, 10, "layers");
      const tape: Entry[] = s.init === "no" ? [] : [range(k).map((q) => step("h", [q]))];
      for (let l = 0; l < p; l++) {
        tape.push(...edges.map(([a, b]): Entry => [step("rzz", [a, b], [], [`2*gamma_${l}`])]));
        tape.push(range(k).map((q) => step("rx", [q], [], [`2*beta_${l}`])));
      }
      return gate(`QAOA${k}`, k, tape);
    },
  },
  {
    id: "pevo", name: "Pauli Evolution", label: "e^{−iHt}", family: "dynamics", qiskit: "qiskit.circuit.library.PauliEvolutionGate", prefix: "PEVO", minQubits: 1,
    note: "e^{−iHT} as a product formula (Lie–Trotter or Suzuki), with its global phase. H is a Pauli sum, q0 rightmost.",
    settings: [
      { key: "h", label: "H", kind: "pauli", default: (k) => (k >= 2 ? pauliTfim(k) : "Z"), hint: "-1*ZZ + -0.5*XI", presets: (k) => presetsFor(k) },
      { key: "time", label: "time T", kind: "expr", default: () => "t" },
      { key: "steps", label: "steps", kind: "int", default: () => "1", min: 1, max: () => 50 },
      { key: "order", label: "order", kind: "choice", default: () => "1", options: [["1", "1 (Lie–Trotter)"], ["2", "2 (Suzuki)"], ["4", "4 (Suzuki)"]] },
    ],
    size: (s) => hamiltonian(s.h ?? "").k,
    build: (k, s) => {
      const H = hamiltonian(s.h ?? "");
      if (H.k !== k) throw new Error(`H acts on ${H.k} qubits`);
      const steps = int(s, "steps", 1, 50);
      const order = Number(s.order || "1") as 1 | 2 | 4;
      const T = (s.time ?? "t").trim() || "t";
      const tape = raiseCircuit(buildTrotterCircuit(H.terms, { steps, delta: `(${T})/${steps}`, order }));
      if (H.identity) tape.push(...phaseSteps(`-(${H.identity})*(${T})`));
      return gate(`PEVO${k}`, k, tape.length ? tape : phaseSteps("0"));
    },
  },
  {
    id: "qpe", name: "Phase Estimation", label: "QPE", family: "estimate", qiskit: "qiskit.circuit.library.phase_estimation", prefix: "QPE", minQubits: 2,
    note: "m counting qubits (the first, least significant first), then the operation's qubits: H, controlled U^(2^j), inverse QFT, as Qiskit lays it out.",
    settings: [
      { key: "m", label: "counting qubits m", kind: "int", default: () => "3", min: 1, max: () => 8 },
      { key: "gate", label: "operation U", kind: "gate", default: () => "" },
    ],
    size: (s, gates) => int(s, "m", 1, 8, "counting qubits") + userGate(s, gates).k,
    build: (k, s, gates) => {
      const m = int(s, "m", 1, 8, "counting qubits");
      const U = userGate(s, gates);
      if (m + U.k !== k) throw new Error(`needs ${m + U.k} qubits`);
      const targets = range(U.k).map((j) => m + j);
      const tape: Entry[] = [range(m).map((q) => step("h", [q]))];
      for (let j = 0; j < m; j++) for (let r = 0; r < 2 ** j; r++) tape.push([step(CUSTOM_PREFIX + U.name, targets, [j])]);
      tape.push(...iqft(m));
      for (let j = 0; j < m >> 1; j++) tape.push([step("swap", [j, m - 1 - j])]); // Qiskit's closing permutation
      return gate(`QPE${m}_${U.name}`, k, tape);
    },
  },
  {
    id: "paulimeas", name: "Pauli Measurement", label: "⟨P⟩", family: "measure", qiskit: "qiskit.quantum_info.Statevector.expectation_value", prefix: "", minQubits: 2,
    note: "Measures the Pauli string P on the first qubits with the last qubit of the block as ancilla (reset first): the bit reads 1 for eigenvalue −1, so ⟨P⟩ = 1 − 2·P(1).",
    settings: [{ key: "pauli", label: "P", kind: "pauli", default: (k) => "Z".repeat(Math.max(1, k - 1)), hint: "XZ (q0 rightmost)" }],
    size: (s) => pauliString(s).length + 1,
    build: (k, s) => ({ entries: pauliMeasurement(k, pauliString(s)) }),
  },
];

export const BLOCK_BY_ID: Record<string, BlockSpec> = Object.fromEntries(BLOCKS.map((b) => [b.id, b]));

/** Pauli Measurement's steps: reset the ancilla, basis changes, CX parity into it, undo, measure it. */
export function pauliMeasurement(k: number, p: string): Entry[] {
  if (p.length !== k - 1) throw new Error(`P acts on ${p.length} qubits`);
  const anc = k - 1;
  const on = range(k - 1).filter((q) => p[k - 2 - q] !== "I");
  const pauli = (q: number) => p[k - 2 - q];
  const out: Entry[] = [[step("reset", [anc])]];
  const into = on.flatMap((q) => (pauli(q) === "X" ? [step("h", [q])] : pauli(q) === "Y" ? [step("sdg", [q]), step("h", [q])] : []));
  const back = on.flatMap((q) => (pauli(q) === "X" ? [step("h", [q])] : pauli(q) === "Y" ? [step("h", [q]), step("s", [q])] : []));
  for (const s of into) out.push([s]);
  for (const q of on) out.push([step("x", [anc], [q])]);
  for (const s of back) out.push([s]);
  out.push([step("measure", [anc])]);
  return out;
}

const pauliTfim = (k: number) => [
  ...range(k - 1).map((i) => `-1*${"I".repeat(k - 2 - i)}ZZ${"I".repeat(i)}`),
  ...range(k).map((i) => `-0.5*${"I".repeat(k - 1 - i)}X${"I".repeat(i)}`),
].join(" + ");

function presetsFor(k: number): [string, string][] {
  const zz = (i: number, a: string) => `${"I".repeat(k - 2 - i)}${a}${a}${"I".repeat(i)}`;
  const out: [string, string][] = [["Z", "I".repeat(k - 1) + "Z"]];
  if (k >= 2) {
    out.push(["TFIM", pauliTfim(k)]);
    out.push(["Heisenberg", range(k - 1).flatMap((i) => ["X", "Y", "Z"].map((a) => `1*${zz(i, a)}`)).join(" + ")]);
    out.push(["XY", range(k - 1).flatMap((i) => ["X", "Y"].map((a) => `1*${zz(i, a)}`)).join(" + ")]);
  }
  return out;
}

/** Default settings for a block on k qubits. */
export const defaultSettings = (spec: BlockSpec, k: number): Settings =>
  Object.fromEntries(spec.settings.map((d) => [d.key, d.default(k)]));

/** One line describing a placed block (the long-press menu's head). */
export function describe(spec: BlockSpec, k: number, s: Settings): string {
  const parts = spec.settings.filter((d) => d.kind !== "symbol" || s[d.key] !== "theta").map((d) => {
    const v = s[d.key] ?? "";
    if (d.kind === "bool") return v === "no" ? `no ${d.label}` : d.label;
    if (d.kind === "choice" || d.kind === "symbol") return `${d.label} ${d.options?.find(([o]) => o === v)?.[1] ?? v}`;
    return `${d.label} ${v}`;
  });
  return [spec.name, `${k} qubit${k > 1 ? "s" : ""}`, ...parts].join(" · ");
}

/** Block gate names: NAMEk and its variants (NAMEk_2, NAMEk_DG, QPE3_G1…). */
const BLOCK_NAME = new RegExp(`^(${BLOCKS.map((b) => b.prefix).filter(Boolean).sort((a, b) => b.length - a.length).join("|")})\\d`);
export const isBlockGate = (name: string) => BLOCK_NAME.test(name);
