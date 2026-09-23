import { productLayer, randomTape, rng, step } from "./tapes";
import type { Entry } from "../../src/calc/steps";

export type StateCase = { id: string; n: number; tape: Entry[] };

const ghz = (n: number): Entry[] => [
  [step("h", [0])],
  ...Array.from({ length: n - 1 }, (_, i) => [step("x", [i + 1], [i])]),
];

/** A spread of pure states: named ones plus product and random entangled states. */
export function stateCases(seed: number, sizes = [3, 4, 5, 6, 7]): StateCase[] {
  const r = rng(seed);
  const out: StateCase[] = [
    { id: "bell", n: 2, tape: ghz(2) },
    { id: "bell-phase", n: 2, tape: [...ghz(2), [step("s", [1])], [step("ry", [0], [], ["0.6"])]] },
    { id: "ghz3", n: 3, tape: ghz(3) },
    { id: "ghz5", n: 5, tape: ghz(5) },
    { id: "product4", n: 4, tape: productLayer(r, 4) },
    { id: "zero3", n: 3, tape: [] },
  ];
  for (const n of sizes) {
    out.push({ id: `rand${n}a`, n, tape: [...productLayer(r, n), ...randomTape(r, n, 3 * n)] });
    out.push({ id: `rand${n}b`, n, tape: randomTape(r, n, 4 * n) });
  }
  return out;
}
