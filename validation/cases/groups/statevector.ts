import { GATES, productLayer, randomTape, rng, step } from "../tapes";
import type { Entry } from "../../../src/calc/steps";

export type Case = { id: string; n: number; tape: Entry[] };

/**
 * Statevector + QASM-export cases. Qiskit imports each exported program and
 * its statevector becomes the reference, so these fixtures check the
 * simulator AND the exporter together (exact, global phase included).
 */
export function gateCases(): Case[] {
  const r = rng(1001);
  const out: Case[] = [];
  const ps = ["0.37", "1.1", "-0.8"];
  for (const [g, { k, p }] of Object.entries(GATES)) {
    for (const nc of [0, 1, 2]) {
      const n = Math.max(3, k + nc + 1);
      const tape: Entry[] = [
        ...productLayer(r, n),
        [step(g, [...Array(k).keys()].map((i) => i + nc), [...Array(nc).keys()], ps.slice(0, p), nc === 2 ? [false, true] : undefined)],
      ];
      out.push({ id: `${g}${nc ? `+c${nc}` : ""}`, n, tape });
    }
  }
  return out;
}

export function randomCases(): Case[] {
  const r = rng(2002);
  return Array.from({ length: 150 }, (_, i) => {
    const n = 3 + r.int(4);
    return { id: `rand${i}`, n, tape: randomTape(r, n, 16) };
  });
}
