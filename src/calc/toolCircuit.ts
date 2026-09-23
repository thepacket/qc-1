import type { Circuit, PlacedGate } from "../sim/types";
import { newGateId } from "./ids";
import { MACROS, NONUNITARY, type Entry, type Step } from "./steps";
import { customOf, expandCustom } from "./custom";

/**
 * Bridge between the tape and the upstream circuit tools (optimiser,
 * transpiler, router, …), which expect Quantiom's gate vocabulary: named
 * controlled gates (cx, ccx, crz, mcx…) whose controls are part of the gate,
 * no anti-controls, no macros.
 *
 * `toolCircuit` lowers a unitary tape into that vocabulary exactly (checked
 * against Qiskit in the tools fixture); `raiseCircuit` maps a tool's output
 * back to tape entries (base gate + controls).
 */

/** Controlled phase angles of the diagonal Clifford+T gates: C^k(G) = MCP(angle). */
const PHASE_OF: Record<string, string> = { z: "π", s: "π/2", sdg: "-π/2", t: "π/4", tdg: "-π/4" };

/** Upstream id for base gate `g` with `k` controls, and its params; null when there is none. */
function named(g: string, k: number, params: string[]): { id: string; params: string[] } | null {
  if (k === 0) return { id: g, params };
  const one: Record<string, string> = {
    x: "cx", y: "cy", z: "cz", h: "ch", sx: "csx", sxdg: "csxdg",
    rx: "crx", ry: "cry", rz: "crz", p: "cp", u1: "cu1", u: "cu3", u3: "cu3", swap: "cswap",
  };
  if (k === 1 && one[g]) return { id: one[g], params };
  if (g === "x") return { id: k === 2 ? "ccx" : k === 3 ? "c3x" : k === 4 ? "c4x" : "mcx", params };
  if (g === "z" && k === 2) return { id: "ccz", params };
  if (g === "p" || g === "u1") return { id: k === 1 ? "cp" : "mcp", params };
  if (PHASE_OF[g]) return { id: k === 1 ? "cp" : "mcp", params: [PHASE_OF[g]] };
  if (g === "u" || g === "u3") return { id: "mcu", params };
  return null;
}

export class ToolInputError extends Error {}

/** Expand macros and anti-controls into plain steps (base gate + positive controls). */
function plainSteps(s: Step): Step[] {
  const def = customOf(s.gateId);
  if (def) return expandCustom(s, def).flatMap(plainSteps);
  const macro = MACROS[s.gateId];
  if (macro) {
    return macro.flatMap(([g, cs, ts]) => plainSteps({
      ...s,
      gateId: g,
      controls: [...s.controls, ...cs.map((q) => s.targets[q])],
      controlStates: s.controlStates && [...s.controlStates, ...cs.map(() => true)],
      targets: ts.map((q) => s.targets[q]),
      params: [],
    }));
  }
  const anti = s.controls.filter((_, i) => s.controlStates && !s.controlStates[i]);
  if (anti.length === 0) return [{ ...s, controlStates: undefined }];
  const flip = (): Step[] => anti.map((q) => ({ ...s, id: newGateId(), gateId: "x", controls: [], controlStates: undefined, targets: [q], params: [] }));
  return [...flip(), { ...s, controlStates: undefined }, ...flip()];
}

/**
 * The tape in upstream tool vocabulary. Throws ToolInputError for tapes the
 * tools can't take: measurements/resets/preps, and controlled gates with no
 * named upstream form (e.g. a controlled RXX).
 */
export function toolCircuit(n: number, tape: Entry[]): Circuit {
  const gates: PlacedGate[] = [];
  tape.forEach((entry, column) => {
    for (const step of entry) {
      if (NONUNITARY.has(step.gateId)) throw new ToolInputError("the tools need a unitary circuit (no measurements, resets or preps)");
      if (step.condition) throw new ToolInputError("the tools can't take conditional (IF) gates");
      for (const s of plainSteps(step)) {
        const nm = named(s.gateId, s.controls.length, s.params);
        if (!nm) throw new ToolInputError(`the tools can't take ${s.gateId.toUpperCase()} with ${s.controls.length} control${s.controls.length > 1 ? "s" : ""}`);
        gates.push({ id: newGateId(), gateId: nm.id, column, controls: [...s.controls], targets: [...s.targets], clbits: [], params: [...nm.params] });
      }
    }
  });
  // Upstream passes expect one gate per column in application order.
  gates.forEach((g, i) => (g.column = i));
  return { numQubits: n, numClbits: 0, gates };
}

/** Upstream named id → QC-1 base gate (the controls stay in `controls`). */
const BASE: Record<string, string> = {
  cx: "x", ccx: "x", c3x: "x", c4x: "x", mcx: "x",
  cy: "y", cz: "z", ccz: "z", ch: "h", csx: "sx", csxdg: "sxdg",
  crx: "rx", cry: "ry", crz: "rz", cp: "p", mcp: "p", cu1: "u1", cu3: "u", mcu: "u", cswap: "swap",
};

/** Markers that carry no operation. */
const SKIP = new Set(["barrier", "delay", "\u0000merge-blocker"]);

/** A tool's output circuit as tape entries (one gate per entry), in application order. */
export function raiseCircuit(c: Circuit): Entry[] {
  const order = [...c.gates].sort((a, b) => a.column - b.column);
  const tape: Entry[] = [];
  for (const g of order) {
    if (SKIP.has(g.gateId)) continue;
    if (g.gateId === "cu") {
      // Controlled-U with a global phase γ on the target: U3 controlled, then P(γ) on the control.
      const [th, ph, la, ga] = g.params;
      tape.push([{ id: newGateId(), gateId: "u", column: 0, controls: [...g.controls], targets: [...g.targets], clbits: [], params: [th, ph, la] }]);
      if (ga && ga !== "0") tape.push([{ id: newGateId(), gateId: "p", column: 0, controls: g.controls.slice(0, -1), targets: [g.controls[g.controls.length - 1]], clbits: [], params: [ga] }]);
      continue;
    }
    tape.push([{
      id: newGateId(), gateId: BASE[g.gateId] ?? g.gateId, column: 0,
      controls: [...g.controls], targets: [...g.targets], clbits: [], params: [...g.params],
      ...(g.controlStates && g.controlStates.some((on) => !on) ? { controlStates: [...g.controlStates] } : {}),
    }]);
  }
  return tape;
}
