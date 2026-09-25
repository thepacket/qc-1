import { applyStep, bitCount, MEASURE_IDS, type Entry, type Scope, type Step } from "./steps";

/**
 * Every measurement history of a tape: each executed measurement or reset
 * splits the state into its two outcomes (probability > 0), and IF
 * conditions are evaluated on each branch's own classical bits. Unlike the
 * register (one recorded history), this is the whole distribution — what
 * running the program many times would show.
 */
export type BranchNode = {
  id: number;
  parent: number | null;
  /** Measurement/reset event index along the path (0 = root). */
  depth: number;
  /** Outcome that led here (null at the root). */
  outcome: 0 | 1 | null;
  /** Probability of reaching this node from the start. */
  p: number;
  /** Which step: "M q2" or "RST q0" (null at the root). */
  label: string | null;
};

export type BranchLeaf = { path: string; p: number; cbits: string };

export type BranchTree = { nodes: BranchNode[]; leaves: BranchLeaf[]; events: number };

const EPS = 1e-12;

/** Probability of outcome 1 for a measurement-like step (in its basis). */
function prob1(state: Float64Array, n: number, s: Step, scope: Scope): number {
  let psi = state;
  const q = s.targets[0];
  const basis = (g: string) => ({ ...s, gateId: g, params: [], controls: [], controlStates: undefined, condition: undefined, outcome: undefined });
  if (s.gateId === "measure_x" || s.gateId === "measure_y") {
    psi = state.slice();
    if (s.gateId === "measure_y") applyStep(psi, n, basis("sdg"), Math.random, scope);
    applyStep(psi, n, basis("h"), Math.random, scope);
  }
  const mask = 1 << q;
  let p = 0;
  for (let i = 0; i < 1 << n; i++) if (i & mask) p += psi[2 * i] ** 2 + psi[2 * i + 1] ** 2;
  return p;
}

export function branchTree(n: number, tape: Entry[], scope: Scope = {}, maxEvents = 8): BranchTree {
  const steps = tape.flat();
  const nodes: BranchNode[] = [{ id: 0, parent: null, depth: 0, outcome: null, p: 1, label: null }];
  const leaves: BranchLeaf[] = [];
  let events = 0;
  const walk = (from: number, state: Float64Array, cbits: Uint8Array, node: BranchNode, path: string) => {
    for (let i = from; i < steps.length; i++) {
      const s = steps[i];
      if (s.condition && cbits[s.condition.clbit] !== s.condition.value) continue;
      if (!MEASURE_IDS.has(s.gateId) && !s.gateId.startsWith("init") && s.gateId !== "initialize") {
        applyStep(state, n, s, Math.random, scope, cbits);
        continue;
      }
      // State preps start with a reset: that is the branching event.
      const p1 = prob1(state, n, MEASURE_IDS.has(s.gateId) ? s : { ...s, gateId: "reset" }, scope);
      if (node.depth + 1 > maxEvents) throw new Error(`more than ${maxEvents} measurements on a path`);
      events = Math.max(events, node.depth + 1);
      const label = `${s.gateId === "reset" || s.gateId.startsWith("init") ? "RST" : s.gateId === "measure_x" ? "MX" : s.gateId === "measure_y" ? "MY" : "M"} q${s.targets[0]}`;
      for (const o of [0, 1] as const) {
        const po = o === 1 ? p1 : 1 - p1;
        if (po < EPS) continue;
        const child: BranchNode = { id: nodes.length, parent: node.id, depth: node.depth + 1, outcome: o, p: node.p * po, label };
        nodes.push(child);
        const st = state.slice(), cb = cbits.slice();
        applyStep(st, n, { ...s, condition: undefined, outcome: o }, Math.random, scope, cb);
        walk(i + 1, st, cb, child, path + o);
      }
      return;
    }
    leaves.push({ path, p: node.p, cbits: [...cbits].reverse().join("") }); // c[k−1] … c[0], as Qiskit prints counts
  };
  const ground = new Float64Array(2 << n);
  ground[0] = 1;
  walk(0, ground, new Uint8Array(bitCount(n, tape)), nodes[0], "");
  return { nodes, leaves, events };
}
