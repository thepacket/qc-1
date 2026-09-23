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

/** W state on 3 qubits: (|100⟩ + |010⟩ + |001⟩)/√3. */
export const wState = (): Entry[] => [
  [step("ry", [0], [], ["2*acos(1/sqrt(3))"])],
  [step("ry", [1], [0], ["π/2"])],
  [step("x", [0], [1])],
  [step("x", [2], [0, 1], [], [true, true])],
];

/** T|+⟩ on every qubit: a product of magic states. */
export const tPlus = (n: number): Entry[] => [
  ...Array.from({ length: n }, (_, q) => [step("h", [q])]),
  ...Array.from({ length: n }, (_, q) => [step("t", [q])]),
];

/** Spin-coherent product state (θ, φ) on every qubit. */
export const coherent = (n: number, theta: string, phi: string): Entry[] =>
  Array.from({ length: n }, (_, q) => [step("u", [q], [], [theta, phi, "0"])]);
