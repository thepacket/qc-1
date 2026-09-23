import { GATES, productLayer, randomTape, rng, step } from "../tapes";
import type { Entry } from "../../../src/calc/steps";
import { defineGate, type CustomGate } from "../../../src/calc/custom";

/** `gates`: custom gate definitions the tape uses (set in the registry before replay/export). */
export type Case = { id: string; n: number; tape: Entry[]; gates?: CustomGate[] };

/** Custom gates: nested definitions, controls and anti-controls, a u_arb inside. */
export function customCases(): Case[] {
  const s = (g: string, t: number[], c: number[] = [], p: string[] = [], anti?: boolean[]): Entry => [step(g, t, c, p, anti)];
  const G1 = defineGate("G1", [s("h", [0]), s("x", [1], [0]), s("rz", [1], [], ["0.3"]), s("sy", [0])]);
  const G2 = defineGate("G2", [s("custom:G1", [2, 0]), s("rzz", [0, 1], [], ["2/3*π"]), s("t", [1], [2])]);
  const G3 = defineGate("G3", [s("u_arb", [0], [], ["0", "0", "0.6", "0.8", "0", "1", "0", "0"]), s("iswap", [0, 1])]);
  const gates = [G1, G2, G3];
  const r = rng(3003);
  return [
    { id: "custom-G1", n: 3, tape: [...productLayer(r, 3), s("custom:G1", [2, 0])], gates },
    { id: "custom-G1+c1", n: 3, tape: [...productLayer(r, 3), s("custom:G1", [0, 2], [1])], gates },
    { id: "custom-G2+anti", n: 4, tape: [...productLayer(r, 4), s("custom:G2", [3, 1, 0], [2], [], [true])], gates },
    { id: "custom-G3+c2", n: 4, tape: [...productLayer(r, 4), s("custom:G3", [1, 3], [0, 2], [], [false, true])], gates },
  ];
}

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
  // u1, u2, u3 (stdgates names), plain and controlled.
  for (const [g, p] of [["u1", ["0.37"]], ["u2", ["0.37", "1.1"]], ["u3", ["0.37", "1.1", "-0.8"]]] as [string, string[]][]) {
    for (const nc of [0, 1, 2]) {
      const n = 3;
      out.push({ id: `${g}${nc ? `+c${nc}` : ""}`, n, tape: [...productLayer(r, n), [step(g, [nc], [...Array(nc).keys()], p, nc === 2 ? [true, false] : undefined)]] });
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
    // 15 digits: the last bits of cos/sin differ between platforms' libm.
    return [...cell(c, al), ...cell(-s, al + la), ...cell(s, al + ph), ...cell(c, al + ph + la)].map((x) => x.toPrecision(15));
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
