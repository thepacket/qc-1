import type { Circuit } from "../sim/types";
import type { Entry } from "./steps";

/**
 * The tape as an upstream-style Circuit, for ported analyses that take one.
 * Each gate keeps its Step fields (base gate id + controls, recorded
 * measurement outcome); `column` is the entry index, and array order is
 * application order.
 */
export function lowerTape(n: number, tape: Entry[]): Circuit {
  return {
    numQubits: n,
    numClbits: 0,
    gates: tape.flatMap((entry, column) => entry.map((s) => ({ ...s, column }))),
  };
}

/** Named controlled forms upstream code expects: base id → control count → name (stdgates). */
export const NAMED: Record<string, Record<number, string>> = {
  x: { 1: "cx", 2: "ccx" },
  y: { 1: "cy" },
  z: { 1: "cz" },
  h: { 1: "ch" },
  rx: { 1: "crx" },
  ry: { 1: "cry" },
  rz: { 1: "crz" },
  p: { 1: "cp" },
  swap: { 1: "cswap" },
};

/**
 * The tape as a Circuit with named controlled gate ids (x + 1 control → cx),
 * for structural analyses ported from upstream (ZX, resources, graphs).
 * Parameters are left as keyed (no QASM renaming).
 */
export function namedCircuit(n: number, tape: Entry[]): Circuit {
  const c = lowerTape(n, tape);
  return { ...c, gates: c.gates.map((g) => ({ ...g, gateId: NAMED[g.gateId]?.[g.controls.length] ?? g.gateId })) };
}
