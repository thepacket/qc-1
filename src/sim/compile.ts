import type { Circuit } from "./types";
import { transpile, type TranspileTarget } from "./transpile";
import { routeCircuit } from "./router";
import { optimiseCircuit } from "./optimisePasses";

/**
 * One-click "compile to device" pipeline. Runs the three existing passes
 * in the order that produces the smallest final gate count on real
 * hardware-shape circuits:
 *
 *   1. Transpile to the target native gate set. Decomposes Toffoli, U3,
 *      SWAP, multi-control families into the native primitives.
 *   2. Optimise (peephole) — catches the cancellations the transpiler's
 *      naive decomposition introduces (H·H, S·S†, Rz(a)·Rz(b)).
 *   3. Route to the coupling map. Inserts SWAPs along BFS paths to bring
 *      non-adjacent 2-qubit-gate qubits together.
 *   4. Optimise again — catches the SWAP·SWAP cancellations the router
 *      sometimes introduces when a circuit moves a qubit and then moves
 *      it back, plus any new same-axis rotation merges.
 *
 * Returns the final circuit + a single before/after report. Each
 * intermediate stage's count is also reported so researchers can see
 * where the cost comes from.
 */

export type CompileResult = {
  circuit: Circuit;
  stages: Array<{ name: string; gates: number; depth: number }>;
  /** QC-1: where each logical qubit ends up (routing permutes them); identity when not routed. */
  finalMapping: number[];
};

export function compileForDevice(
  circuit: Circuit,
  target: TranspileTarget,
  coupling: number[][] | undefined,
): CompileResult {
  const stages: CompileResult["stages"] = [];
  const record = (name: string, c: Circuit) => {
    const maxCol = c.gates.reduce((m, g) => Math.max(m, g.column), -1);
    stages.push({ name, gates: c.gates.length, depth: maxCol + 1 });
  };
  record("input", circuit);

  let cur = transpile(circuit, target).circuit;
  record("transpile", cur);

  cur = optimiseCircuit(cur).circuit;
  record("optimise", cur);

  let finalMapping = Array.from({ length: circuit.numQubits }, (_, i) => i);
  if (coupling && coupling.length > 0) {
    const routed = routeCircuit(cur, coupling);
    cur = routed.circuit;
    finalMapping = routed.finalMapping;
    record("route", cur);

    cur = optimiseCircuit(cur).circuit;
    record("optimise", cur);
  }

  // Final naming.
  const label = target === "clifford-t" ? "Clifford+T" : target === "ibm-heavy-hex" ? "IBM heavy-hex" : "Rigetti";
  cur = { ...cur, name: `${circuit.name ?? "Untitled"} → ${label}${coupling ? " (routed)" : ""}` };

  return { circuit: cur, stages, finalMapping };
}
