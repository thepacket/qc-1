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
