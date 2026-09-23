import { readFileSync, readdirSync } from "node:fs";
import { importQasm } from "../../../src/qasm/import";
import { exportQasm3 } from "../../../src/qasm/fromTape";
import { setCustomGates } from "../../../src/calc/custom";
import { Register } from "../../../src/calc/register";
import { branchTree } from "../../../src/calc/branches";
import { MEASURE_IDS, NONUNITARY, type Entry } from "../../../src/calc/steps";

const DIR = new URL("../../../examples/", import.meta.url);

export const exampleFiles = () => readdirSync(DIR).filter((f) => f.endsWith(".qasm")).sort();

/** Symbol values for the comparison: t = 0.9, the others 0.3, 0.47, 0.64, … in name order. */
export function bindings(symbols: string[]): Record<string, number> {
  const others = symbols.filter((s) => s !== "t").sort();
  return { ...(symbols.includes("t") ? { t: 0.9 } : {}), ...Object.fromEntries(others.map((s, i) => [s, 0.3 + 0.17 * i])) };
}

/** True when every measurement is final: nothing acts on a measured qubit afterwards, no resets or IF. */
function finalMeasurementsOnly(tape: Entry[]): boolean {
  const measured = new Set<number>();
  for (const s of tape.flat()) {
    if (s.condition) return false;
    if (MEASURE_IDS.has(s.gateId)) {
      if (s.gateId !== "measure") return false;
      measured.add(s.targets[0]);
      continue;
    }
    if (NONUNITARY.has(s.gateId)) return false;
    if ([...s.controls, ...s.targets].some((q) => measured.has(q))) return false;
  }
  return true;
}

export function compute(file: string) {
  const src = readFileSync(new URL(file, DIR), "utf8");
  setCustomGates([]);
  const r = importQasm(src);
  setCustomGates(r.gates);
  const syms = new Register(r.n, r.tape).symbols();
  const scope = bindings(syms);
  const exported = exportQasm3(r.n, r.tape);
  if (finalMeasurementsOnly(r.tape)) {
    const unitary = r.tape.map((e) => e.filter((s) => s.gateId !== "measure")).filter((e) => e.length);
    return { file, n: r.n, symbols: syms, scope, kind: "state" as const, state: Array.from(new Register(r.n, unitary, scope).state), exported, notes: r.notes };
  }
  const tree = branchTree(r.n, r.tape, scope, 10);
  return { file, n: r.n, symbols: syms, scope, kind: "branches" as const, branches: tree.leaves.sort((a, b) => (a.path < b.path ? -1 : 1)), exported, notes: r.notes };
}
