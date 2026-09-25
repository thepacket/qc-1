import type { Entry, Step } from "./steps";

/**
 * Custom gates: a run of tape entries saved as a named k-qubit gate
 * (DEFINE in CATALOG). The definition's qubits are local, 0..k−1, in the
 * order of the original qubits; symbols in it stay symbols and take the
 * register's values. A tape step `custom:G1` expands in place (applyStep),
 * so every analysis, tool and export sees the same operation.
 *
 * The registry is per worker: the core and analysis workers each hold a
 * copy, set from the calculator (core command `gates`, analysis snapshots).
 */
export type CustomGate = {
  name: string;
  k: number;
  tape: Entry[];
  /** What it is, for the long-press menu (a block's name and settings); not exported. */
  about?: string;
  /** The gate this one is the inverse of (NAME_DG → NAME). */
  inverseOf?: string;
};

export const CUSTOM_PREFIX = "custom:";

const REGISTRY = new Map<string, CustomGate>();

export function setCustomGates(defs: CustomGate[]) {
  REGISTRY.clear();
  for (const d of defs) REGISTRY.set(d.name, d);
}

export function customGates(): CustomGate[] {
  return [...REGISTRY.values()];
}

export function customOf(gateId: string): CustomGate | undefined {
  return gateId.startsWith(CUSTOM_PREFIX) ? REGISTRY.get(gateId.slice(CUSTOM_PREFIX.length)) : undefined;
}

/**
 * A custom gate's steps placed on `s`'s qubits: local qubit j → s.targets[j],
 * with `s`'s controls (and anti-controls) added to every step.
 */
export function expandCustom(s: Step, def: CustomGate): Step[] {
  return def.tape.flat().map((d, i) => ({
    ...d,
    id: `${s.id}.${i}`,
    column: s.column,
    targets: d.targets.map((q) => s.targets[q]),
    controls: [...s.controls, ...d.controls.map((q) => s.targets[q])],
    controlStates: s.controlStates || d.controlStates
      ? [...(s.controlStates ?? s.controls.map(() => true)), ...(d.controlStates ?? d.controls.map(() => true))]
      : undefined,
    outcome: undefined,
  }));
}

/**
 * Define a gate from tape entries: the qubits they touch, in ascending order,
 * become the gate's local qubits 0..k−1.
 */
export function defineGate(name: string, entries: Entry[]): CustomGate {
  const used = [...new Set(entries.flat().flatMap((s) => [...s.controls, ...s.targets]))].sort((a, b) => a - b);
  const local = new Map(used.map((q, j) => [q, j]));
  const tape = entries.map((e) => e.map((s) => ({
    ...s,
    targets: s.targets.map((q) => local.get(q)!),
    controls: s.controls.map((q) => local.get(q)!),
    outcome: undefined,
  })));
  return { name, k: used.length, tape };
}
