/**
 * Every gate QC-1 can place, as data: the palette shows them, the editing
 * API checks against them. A controlled gate is a base gate plus controls
 * (CX = x with one control), as the tape stores it. Names, parameter names
 * and defaults come from the ported gate catalog (sim/gates.ts).
 */
import { GATES_BY_ID } from "../sim/gates";
import { BLOCKS, isBlockGate, type Family } from "./blockLib";

export type ParamDef = { name: string; default: string };

export type PaletteGroup =
  | "pauli" | "rotation" | "controlled" | "two" | "multi" | "measure" | "prep" | "blocks" | "typed" | "custom";

export const PALETTE_GROUPS: { id: PaletteGroup; label: string }[] = [
  { id: "prep", label: "State Init" },
  { id: "pauli", label: "Pauli & Clifford" },
  { id: "rotation", label: "Rotations & Phases" },
  { id: "controlled", label: "Controlled" },
  { id: "two", label: "Two-qubit" },
  { id: "multi", label: "Multi-qubit" },
  { id: "measure", label: "Measure & Reset" },
  { id: "blocks", label: "Blocks" },
  { id: "typed", label: "Custom" },
  { id: "custom", label: "Your gates" },
];

/** A palette entry. `targets` qubits (+ `controls`) are placed consecutively from the drop wire, controls first. */
export type PaletteItem =
  | { kind: "gate"; id: string; gate: string; controls: number; targets: number; label: string; name: string; group: PaletteGroup; params: ParamDef[]; note?: string }
  | { kind: "block"; id: string; block: string; family: Family; label: string; name: string; group: "blocks"; note: string }
  | { kind: "typed"; id: string; typed: "state" | "matrix"; label: string; name: string; group: "typed"; note: string }
  | { kind: "custom"; id: string; gate: string; targets: number; label: string; name: string; group: "custom"; note: string };

/** Qubits a base gate acts on (without controls). Macros and 2-qubit natives included. */
export const BASE_ARITY: Record<string, number> = { rccx: 3, rcccx: 4 };
export function baseArity(gate: string): number {
  if (gate in BASE_ARITY) return BASE_ARITY[gate];
  const d = GATES_BY_ID[gate];
  return d ? d.numTargets : 1;
}
export function paramDefs(gate: string): ParamDef[] {
  if (gate === "initialize") return [{ name: "α", default: "1" }, { name: "β", default: "0" }];
  return (GATES_BY_ID[gate]?.params ?? []).map((p) => ({ name: p.name, default: p.default }));
}

const g = (id: string, gate: string, controls: number, group: PaletteGroup, label?: string, note?: string): PaletteItem => {
  const d = GATES_BY_ID[gate];
  return {
    kind: "gate", id, gate, controls, targets: baseArity(gate), group,
    label: label ?? (controls ? `${"C".repeat(controls)}${d?.symbol ?? gate.toUpperCase()}` : d?.symbol ?? gate.toUpperCase()),
    name: controls ? `${controls === 1 ? "Controlled" : `${controls}-controlled`} ${d?.name ?? gate}` : d?.name ?? gate,
    params: paramDefs(gate), note: note ?? d?.description,
  };
};

export const PALETTE: PaletteItem[] = [
  ...["h", "x", "y", "z", "s", "sdg", "t", "tdg", "sx", "sxdg", "sy", "sydg", "i"].map((id) => g(id, id, 0, "pauli")),
  ...["rx", "ry", "rz", "p", "u", "r", "gpi", "gpi2"].map((id) => g(id, id, 0, "rotation")),
  g("cx", "x", 1, "controlled", "CX"), g("cy", "y", 1, "controlled", "CY"), g("cz", "z", 1, "controlled", "CZ"),
  g("ch", "h", 1, "controlled", "CH"), g("csx", "sx", 1, "controlled", "C√X"),
  g("crx", "rx", 1, "controlled", "CRX"), g("cry", "ry", 1, "controlled", "CRY"), g("crz", "rz", 1, "controlled", "CRZ"),
  g("cp", "p", 1, "controlled", "CP"), g("cswap", "swap", 1, "controlled", "CSWAP", "Fredkin: swaps the targets when the control is |1⟩."),
  ...["swap", "iswap", "rxx", "ryy", "rzz", "rzx", "xx_plus_yy", "xx_minus_yy", "fsim", "sqrtswap", "sqrtswapdg", "ecr", "dcx", "ms"].map((id) => g(id, id, 0, "two")),
  g("ccx", "x", 2, "multi", "CCX", "Toffoli: flips the target when both controls are |1⟩."),
  g("ccz", "z", 2, "multi", "CCZ"),
  g("c3x", "x", 3, "multi", "C3X"),
  g("rccx", "rccx", 0, "multi", "RCCX", "Toffoli up to a relative phase (Margolus): the first two qubits act as controls."),
  g("rcccx", "rcccx", 0, "multi", "RC3X", "C3X up to relative phases: the first three qubits act as controls."),
  g("measure", "measure", 0, "measure", "M", "Measure in Z; the outcome is recorded (and written to c[q])."),
  g("measure_x", "measure_x", 0, "measure", "MX"), g("measure_y", "measure_y", 0, "measure", "MY"),
  g("reset", "reset", 0, "measure", "reset", "Reset to |0⟩ (a recorded measurement, then X on 1)."),
  ...["init0", "init1", "initplus", "initminus", "initiplus", "initiminus"].map((id) => g(id, id, 0, "prep", undefined, "Reset, then prepare this state.")),
  g("initialize", "initialize", 0, "prep", "|ψ⟩", "Reset, then α|0⟩ + β|1⟩ (set α, β after placing it)."),
  ...BLOCKS.map((b): PaletteItem => ({
    kind: "block", id: `block:${b.id}`, block: b.id, family: b.family, label: b.name, name: b.name, group: "blocks",
    note: `${b.note} ${b.qiskit ? `Checked against ${b.qiskit}.` : "A QC-1 definition."}`,
  })),
  { kind: "typed", id: "typed:state", typed: "state", label: "State…", name: "Type a state", group: "typed", note: "Type |00⟩ + |11⟩ or amplitudes: reset, then prepare it." },
  { kind: "typed", id: "typed:matrix", typed: "matrix", label: "Matrix…", name: "Type a matrix", group: "typed", note: "Type a unitary (rows by ;), up to 16×16: it becomes a gate." },
];

/** Base gate → its palette group (uncontrolled items only). */
const BASE_GROUP: Record<string, PaletteGroup> = Object.fromEntries(
  PALETTE.flatMap((p) => (p.kind === "gate" && p.controls === 0 ? [[p.gate, p.group]] : [])),
);

/**
 * The palette group a placed step belongs to (its colour on the diagram):
 * one control → Controlled, more → Multi-qubit; blocks and typed gates by
 * their names (QFTk, GROVERk…, see blockLib.ts; PSIj, Mj); anything else not in the
 * palette (imported u_arb…) counts as a rotation.
 */
export function groupOf(gateId: string, controls: number): PaletteGroup {
  if (gateId.startsWith("custom:")) {
    const name = gateId.slice(7);
    if (isBlockGate(name)) return "blocks";
    if (/^(PSI|M)\d+$/.test(name)) return "typed";
    return "custom";
  }
  if (controls >= 2) return "multi";
  if (controls === 1) return BASE_GROUP[gateId] === "two" ? "multi" : "controlled";
  return BASE_GROUP[gateId] ?? "rotation";
}

export const PALETTE_BY_ID: Record<string, PaletteItem> = Object.fromEntries(PALETTE.map((p) => [p.id, p]));

/** Qubits a palette item needs when dropped (blocks and typed items: chosen when placed). */
export function itemWidth(p: PaletteItem): number {
  return p.kind === "gate" ? p.controls + p.targets : p.kind === "custom" ? p.targets : 0;
}

/** `need` consecutive wires from `row`, pulled up if they'd run past the last wire (Quantiom's rule). */
export function spanFrom(row: number, need: number, n: number): number[] {
  const start = Math.max(0, Math.min(row, n - need));
  return Array.from({ length: Math.min(need, n) }, (_, i) => start + i);
}
