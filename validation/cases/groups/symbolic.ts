import { Register } from "../../../src/calc/register";
import type { Entry, Scope } from "../../../src/calc/steps";
import { GATES, rng, step } from "../tapes";

/** Symbolic angle expressions as the keypad produces them. */
const SYM_EXPRS = ["θ", "2*θ+π/4", "t/2", "φ-θ", "3*t", "-λ", "θ*t", "π*φ/3", "t"];
export const POINTS: Scope[] = [
  { theta: 0, phi: 0, lambda: 0, t: 0 },
  { theta: 0.37, phi: -1.2, lambda: 2.1, t: 1.1 },
  { theta: Math.PI / 3, phi: 0.5, lambda: -0.7, t: 2 * Math.PI - 0.1 },
  { theta: -2.9, phi: 3.0, lambda: 0.2, t: 0.004 },
  { theta: 1.0, phi: 1.0, lambda: 1.0, t: Math.PI },
];

export type SymCase = { id: string; n: number; tape: Entry[] };

/** Random tapes whose rotation angles are symbolic; unitary gates only (exact comparison). */
export function cases(): SymCase[] {
  const r = rng(5005);
  const param = Object.keys(GATES).filter((g) => GATES[g].p > 0);
  const plain = Object.keys(GATES).filter((g) => GATES[g].p === 0 && GATES[g].k <= 2);
  return Array.from({ length: 30 }, (_, i) => {
    const n = 2 + r.int(4);
    const tape: Entry[] = [];
    for (let d = 0; d < 14; d++) {
      const g = r.next() < 0.6 ? r.pick(param.filter((x) => GATES[x].k <= n)) : r.pick(plain.filter((x) => GATES[x].k <= n));
      const { k, p } = GATES[g];
      const qs = r.shuffle([...Array(n).keys()]);
      const controls = qs.slice(k, k + Math.min(n - k, r.int(2)));
      tape.push([step(g, qs.slice(0, k), controls, Array.from({ length: p }, () => r.pick(SYM_EXPRS)))]);
    }
    return { id: `sym${i}`, n, tape };
  });
}

/** QC-1 states at each point: a fresh register, and one register re-scoped in place. */
export function compute(c: SymCase) {
  const moving = new Register(c.n, c.tape, POINTS[0]);
  return POINTS.map((p) => {
    moving.setScope(p);
    return { fresh: Array.from(new Register(c.n, c.tape, p).state), replayed: Array.from(moving.state) };
  });
}
