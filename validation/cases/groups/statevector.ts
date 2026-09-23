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
  // Integer ratios: OpenQASM 3 divides integers as integers, so the export must write floats.
  for (const [name, expr] of [["half", "1/2"], ["twothirdspi", "2/3*π"], ["nested", "(1/2)*(3/4)*π"], ["int", "2"]]) {
    out.push({ id: `rz-${name}`, n: 1, tape: [[step("h", [0])], [step("rz", [0], [], [expr])]] });
  }
  // u_arb: random 2×2 unitaries (plain, controlled, anti-controlled), plus
  // the θ = π and diagonal edge cases of the ZYZ export.
  const unitary2 = (): string[] => {
    const [th, ph, la, al] = [r.next() * Math.PI, r.next() * 6 - 3, r.next() * 6 - 3, r.next() * 6 - 3];
    const c = Math.cos(th / 2), s = Math.sin(th / 2);
    const cell = (m: number, a: number) => [m * Math.cos(a), m * Math.sin(a)];
    return [...cell(c, al), ...cell(-s, al + la), ...cell(s, al + ph), ...cell(c, al + ph + la)].map((x) => x.toPrecision(17));
  };
  const special: Record<string, string[]> = {
    offdiag: ["0", "0", "0.6", "0.8", "0", "1", "0", "0"],
    diag: ["0", "1", "0", "0", "0", "0", String(Math.cos(0.3)), String(Math.sin(0.3))],
  };
  for (const nc of [0, 1, 2]) {
    const n = 3;
    for (const [name, params] of [["rand", unitary2()], ...Object.entries(special)] as [string, string[]][]) {
      const tape: Entry[] = [...productLayer(r, n), [step("u_arb", [nc], [...Array(nc).keys()], params, nc === 2 ? [true, false] : undefined)]];
      out.push({ id: `u_arb-${name}${nc ? `+c${nc}` : ""}`, n, tape });
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
