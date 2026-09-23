import { mulberry32 } from "../../src/sim/measure";
import type { Entry, Step } from "../../src/calc/steps";

/** Seeded RNG helpers for case generation (deterministic across runs). */
export function rng(seed: number) {
  const r = mulberry32(seed);
  return {
    next: r,
    int: (k: number) => Math.floor(r() * k),
    pick: <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)],
    shuffle: <T,>(a: readonly T[]) => {
      const b = [...a];
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
      }
      return b;
    },
  };
}
export type Rng = ReturnType<typeof rng>;

/** Unitary gates QC-1 can place, with their qubit count and parameter count. */
export const GATES: Record<string, { k: number; p: number }> = {
  h: { k: 1, p: 0 }, x: { k: 1, p: 0 }, y: { k: 1, p: 0 }, z: { k: 1, p: 0 },
  s: { k: 1, p: 0 }, sdg: { k: 1, p: 0 }, t: { k: 1, p: 0 }, tdg: { k: 1, p: 0 },
  sx: { k: 1, p: 0 }, sxdg: { k: 1, p: 0 }, sy: { k: 1, p: 0 }, sydg: { k: 1, p: 0 }, i: { k: 1, p: 0 },
  rx: { k: 1, p: 1 }, ry: { k: 1, p: 1 }, rz: { k: 1, p: 1 }, p: { k: 1, p: 1 }, u: { k: 1, p: 3 },
  r: { k: 1, p: 2 }, gpi: { k: 1, p: 1 }, gpi2: { k: 1, p: 1 },
  swap: { k: 2, p: 0 }, iswap: { k: 2, p: 0 }, dcx: { k: 2, p: 0 }, ecr: { k: 2, p: 0 },
  sqrtswap: { k: 2, p: 0 }, sqrtswapdg: { k: 2, p: 0 },
  rxx: { k: 2, p: 1 }, ryy: { k: 2, p: 1 }, rzz: { k: 2, p: 1 }, rzx: { k: 2, p: 1 },
  fsim: { k: 2, p: 2 }, xx_plus_yy: { k: 2, p: 2 }, xx_minus_yy: { k: 2, p: 2 }, ms: { k: 2, p: 3 },
  rccx: { k: 3, p: 0 }, rcccx: { k: 4, p: 0 },
};

/** Angle expressions as the keypad produces them (π arithmetic, √, decimals). */
export const EXPRS = ["π/2", "3*π/4", "-π/3", "0.37", "sqrt(2)/3", "2*π/5", "1/sqrt(3)*π", "-1.1"];

let sid = 0;
export function step(gateId: string, targets: number[], controls: number[] = [], params: string[] = [], anti?: boolean[]): Step {
  return {
    id: `v${sid++}`, gateId, column: 0, targets, controls, clbits: [], params,
    ...(anti && anti.some(Boolean) ? { controlStates: anti.map((a) => !a) } : {}),
  };
}

/** A random unitary tape: every gate kind, 0–3 controls, some anti-controls. */
export function randomTape(r: Rng, n: number, depth: number, gates = Object.keys(GATES)): Entry[] {
  const fit = gates.filter((g) => GATES[g].k <= n);
  const tape: Entry[] = [];
  for (let d = 0; d < depth; d++) {
    const g = r.pick(fit);
    const { k, p } = GATES[g];
    const qs = r.shuffle([...Array(n).keys()]);
    const targets = qs.slice(0, k);
    const free = qs.slice(k);
    const controls = free.slice(0, Math.min(free.length, r.int(4)));
    const anti = controls.map(() => r.next() < 0.3);
    tape.push([step(g, targets, controls, Array.from({ length: p }, () => r.pick(EXPRS)), anti)]);
  }
  return tape;
}

/** A layer of arbitrary single-qubit U gates: a generic product state to start from. */
export function productLayer(r: Rng, n: number): Entry[] {
  return [...Array(n).keys()].map((q) => [
    step("u", [q], [], [(r.next() * 3).toFixed(4), (r.next() * 6 - 3).toFixed(4), (r.next() * 6 - 3).toFixed(4)]),
  ]);
}
