import { toolCircuit, raiseCircuit, ToolInputError } from "../../../src/calc/toolCircuit";
import { equivalent } from "../../../src/calc/equiv";
import { circuitResources } from "../../../src/calc/resources";
import { optimiseCircuit } from "../../../src/sim/optimisePasses";
import { transpile, type TranspileTarget } from "../../../src/sim/transpile";
import { routeCircuit } from "../../../src/sim/router";
import { compileForDevice } from "../../../src/sim/compile";
import { inverseGates } from "../../../src/sim/inverse";
import { exportQasm3 } from "../../../src/qasm/fromTape";
import type { Entry } from "../../../src/calc/steps";
import { randomTape, rng, step } from "../tapes";

/** Coupling maps (adjacency lists) the routing tools are checked on. */
export const COUPLINGS: Record<string, (n: number) => number[][]> = {
  line: (n) => Array.from({ length: n }, (_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < n)),
  ring: (n) => Array.from({ length: n }, (_, i) => [...new Set([(i + n - 1) % n, (i + 1) % n])].filter((j) => j !== i)),
};

/** Native gate ids of each transpile target (QC-1 tape vocabulary: base id + controls). */
export const NATIVE: Record<TranspileTarget, (s: { gateId: string; controls: number[]; params: string[] }) => boolean> = {
  "clifford-t": (s) => (["i", "x", "y", "z", "h", "s", "sdg", "t", "tdg"].includes(s.gateId) && s.controls.length === 0) || (s.gateId === "x" && s.controls.length === 1),
  "ibm-heavy-hex": (s) => (["i", "rz", "sx"].includes(s.gateId) && s.controls.length === 0) || (s.gateId === "x" && s.controls.length === 1),
  rigetti: (s) => (["i", "rz"].includes(s.gateId) && s.controls.length === 0) || (s.gateId === "z" && s.controls.length === 1)
    || (s.gateId === "rx" && s.controls.length === 0 && (s.params[0] === "π/2" || s.params[0] === "-π/2")),
};

export type ToolCase = { id: string; n: number; tape: Entry[] };

/** Random tapes the tools accept (unitary, controls with a named upstream form), plus fixed circuits. */
export function cases(): ToolCase[] {
  const r = rng(6006);
  const s = (g: string, t: number[], c: number[] = [], p: string[] = []): Entry => [step(g, t, c, p)];
  const out: ToolCase[] = [
    { id: "ghz4", n: 4, tape: [s("h", [0]), s("x", [1], [0]), s("x", [2], [1]), s("x", [3], [2])] },
    { id: "qft3", n: 3, tape: [s("h", [0]), s("p", [0], [1], ["π/2"]), s("p", [0], [2], ["π/4"]), s("h", [1]), s("p", [1], [2], ["π/2"]), s("h", [2]), s("swap", [0, 2])] },
    { id: "toffoli", n: 3, tape: [s("h", [0]), s("h", [1]), s("x", [2], [0, 1]), s("t", [2]), s("z", [0], [1, 2])] },
    { id: "cancel", n: 2, tape: [s("h", [0]), s("h", [0]), s("s", [1]), s("sdg", [1]), s("rz", [0], [], ["0.3"]), s("rz", [0], [], ["0.4"]), s("x", [1], [0]), s("x", [1], [0])] },
    { id: "farcx6", n: 6, tape: [s("h", [0]), s("x", [5], [0]), s("x", [3], [1]), s("swap", [0, 4]), s("x", [2], [5]), s("rzz", [1, 4], [], ["0.7"])] },
  ];
  let k = 0;
  while (out.length < 45) {
    const n = 1 + r.int(k < 30 ? 4 : 6);
    const tape = randomTape(r, n, 4 + r.int(10)).filter((e) => {
      try { toolCircuit(n, [e]); return true; } catch (err) { if (err instanceof ToolInputError) return false; throw err; }
    });
    out.push({ id: `rand${k++}`, n, tape });
  }
  return out;
}

type ToolOut = { tape: Entry[]; perm?: number[]; skipped?: string[]; target?: TranspileTarget };

export function tools(c: ToolCase): Record<string, ToolOut> {
  const circ = () => toolCircuit(c.n, c.tape);
  const out: Record<string, ToolOut> = {
    optimise: { tape: raiseCircuit(optimiseCircuit(circ()).circuit) },
    "optimise-deep": { tape: raiseCircuit(optimiseCircuit(circ(), { deep: true }).circuit) },
  };
  for (const tg of ["clifford-t", "ibm-heavy-hex", "rigetti"] as TranspileTarget[]) {
    const t = transpile(circ(), tg);
    out[`transpile-${tg}`] = { tape: raiseCircuit(t.circuit), skipped: t.skipped.map((x) => x.gateId), target: tg };
  }
  for (const [name, map] of Object.entries(COUPLINGS)) {
    if (c.n < 3 && name === "ring") continue;
    const rt = routeCircuit(circ(), map(c.n));
    out[`route-${name}`] = { tape: raiseCircuit(rt.circuit), perm: rt.finalMapping };
  }
  const cp = compileForDevice(circ(), "ibm-heavy-hex", COUPLINGS.line(c.n));
  out["compile-ibm-line"] = { tape: raiseCircuit(cp.circuit), perm: cp.finalMapping, target: "ibm-heavy-hex" };
  const inv = inverseGates(circ(), 0, Number.MAX_SAFE_INTEGER);
  out.inverse = { tape: raiseCircuit({ ...circ(), gates: inv.inverted }), skipped: inv.skipped.map((g) => g.gateId) };
  return out;
}

/** Everything QC-1 says about a case: each tool's output and verdict, and the input's resources. */
export function compute(c: ToolCase) {
  const outs = tools(c);
  const res: Record<string, unknown> = {};
  for (const [name, o] of Object.entries(outs)) {
    // Inverse: the output must be A†, i.e. A followed by the output is the identity.
    const eq = name === "inverse" ? equivalent(c.n, [...c.tape, ...o.tape], []) : equivalent(c.n, c.tape, o.tape, { perm: o.perm });
    const nonNative = o.target ? o.tape.flat().filter((s) => !NATIVE[o.target!](s)).length : null;
    res[name] = {
      qasm: exportQasm3(c.n, o.tape), perm: o.perm ?? null, equal: eq.equal, maxErr: eq.maxErr,
      skipped: o.skipped ?? [], nonNative, resources: circuitResources(c.n, o.tape),
    };
  }
  return { tools: res, resources: circuitResources(c.n, c.tape) };
}
