import { Register } from "../../../src/calc/register";
import { circuitResources } from "../../../src/calc/resources";
import { branchTree } from "../../../src/calc/branches";
import type { Entry, Step } from "../../../src/calc/steps";
import { rng, step } from "../tapes";

export type ClassicalCase = { id: string; n: number; tape: Entry[] };

const cond = (s: Step, clbit: number, value: number): Step => ({ ...s, condition: { clbit, value } });

/**
 * Mid-circuit measurements (c[q] ← q by default, or any bit c[j]), resets and
 * IF-conditioned gates, replayed with recorded outcomes. Teleportation is the
 * fixed case.
 */
export function cases(): ClassicalCase[] {
  const r = rng(4114);
  const s = (g: string, t: number[], c: number[] = [], p: string[] = []) => step(g, t, c, p);
  const teleport: Entry[] = [
    [s("u", [0], [], ["0.7", "0.3", "-0.4"])], [s("h", [1])], [s("x", [2], [1])], [s("x", [1], [0])], [s("h", [0])],
    [s("measure", [0])], [s("measure", [1])], [cond(s("x", [2]), 1, 1)], [cond(s("z", [2]), 0, 1)],
  ];
  const out: ClassicalCase[] = [{ id: "teleport", n: 3, tape: teleport }];
  const ONE = ["h", "x", "sx", "t", "s", "y"];
  for (let k = 0; out.length < 20; k++) {
    const n = 2 + r.int(3);
    const tape: Entry[] = [];
    for (let d = 0; d < 8 + r.int(8); d++) {
      const q = r.int(n);
      const u = r.next();
      let st: Step;
      if (u < 0.35) st = s(r.pick(ONE), [q]);
      else if (u < 0.5) st = s("rx", [q], [], [r.pick(["0.7", "π/3", "2/3*π"])]);
      else if (u < 0.7) st = s(r.pick(["x", "z"]), [(q + 1 + r.int(n - 1)) % n], [q]);
      else if (u < 0.85) st = s(r.pick(["measure", "measure", "measure_x", "reset"]), [q]);
      else st = s(r.pick(["x", "h", "measure"]), [q]);
      if (u >= 0.85 || r.next() < 0.2) st = cond(st, r.int(n), r.int(2));
      tape.push([st]);
    }
    out.push({ id: `rand${k}`, n, tape });
  }
  // A classical register of its own (Quantiom's): measurements write any bit
  // c[j] (not only their qubit's), several qubits may write one bit, and IF
  // reads bits beyond the qubit count.
  for (let k = 0; k < 12; k++) {
    const n = 2 + r.int(3);
    const nc = 1 + r.int(n + 2);
    const tape: Entry[] = [];
    for (let d = 0; d < 8 + r.int(8); d++) {
      const q = r.int(n);
      const u = r.next();
      let st: Step;
      if (u < 0.35) st = s(r.pick(ONE), [q]);
      else if (u < 0.5) st = s("ry", [q], [], [r.pick(["0.9", "π/3"])]);
      else if (u < 0.65) st = s(r.pick(["x", "z"]), [(q + 1 + r.int(n - 1)) % n], [q]);
      else st = { ...s(r.pick(["measure", "measure", "measure_x", "measure_y"]), [q]), clbits: [r.int(nc)] };
      if (u < 0.65 && r.next() < 0.35) st = cond(st, r.int(nc), r.int(2));
      tape.push([st]);
    }
    out.push({ id: `bits${k}`, n, tape });
  }
  // Record outcomes as a run would (seeded).
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return out.map((c) => {
    const reg = new Register(c.n);
    for (const e of c.tape) reg.push(e, rnd);
    return { ...c, tape: reg.tape };
  });
}

export function compute(c: ClassicalCase) {
  const reg = new Register(c.n, c.tape);
  let branches: { path: string; p: number; cbits: string }[] | null = null;
  try {
    branches = branchTree(c.n, c.tape, {}, 8).leaves.sort((a, b) => (a.path < b.path ? -1 : 1));
  } catch {
    branches = null; // more than 8 events on a path
  }
  return { state: Array.from(reg.state), cbits: Array.from(reg.cbits), resources: circuitResources(c.n, c.tape), branches };
}
