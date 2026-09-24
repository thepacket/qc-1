import type { Circuit } from "./types";

/**
 * Causal light cone of a qubit through the circuit — a purely structural
 * (topological) computation, no simulation.
 *
 *   "backward": the set of gates that can influence the *final* state of
 *               the target qubit (sweep from the last column backward,
 *               growing the active-qubit set whenever a gate touches it).
 *   "forward":  the set of gates that the target qubit's *input* can
 *               influence (sweep forward).
 *
 * Returns the set of gate ids inside the cone. Markers (barrier/delay)
 * are skipped — they don't propagate causal influence. QC-1: measurements
 * and IF conditions link qubits through the classical bits.
 */
export function computeLightCone(
  circuit: Circuit,
  target: number,
  direction: "backward" | "forward",
): Set<string> {
  const cone = new Set<string>();
  if (target < 0 || target >= circuit.numQubits) return cone;

  const ordered = [...circuit.gates].sort(
    (a, b) => a.column - b.column || a.id.localeCompare(b.id),
  );
  if (direction === "backward") ordered.reverse();

  // QC-1 fix (docs/quantiom-bugs.md #49): classical feedforward carries influence
  // too. Bit c[k] is wire n + k: a measurement of q writes c[q] (QC-1's
  // convention), a conditioned gate reads c[k]. Measure q0 → IF c[0] X q1 puts
  // the measurement in q1's backward cone.
  const n = circuit.numQubits;
  const WRITES = new Set(["measure", "measure_x", "measure_y"]);
  const active = new Set<number>([target]);
  for (const g of ordered) {
    if (g.gateId === "barrier" || g.gateId === "delay") continue;
    const cond = (g as { condition?: { clbit: number } }).condition;
    const qs = [...g.controls, ...g.targets, ...(WRITES.has(g.gateId) ? [n + g.targets[0]] : []), ...(cond ? [n + cond.clbit] : [])];
    if (qs.some((q) => active.has(q))) {
      cone.add(g.id);
      for (const q of qs) active.add(q);
    }
  }
  return cone;
}
