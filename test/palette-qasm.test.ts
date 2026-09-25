import { describe, test, expect } from "vitest";
import { calc, add, stateOf } from "./ed";
import { PALETTE, type PaletteItem } from "../src/calc/gateSpecs";
import { exportQasm3 } from "../src/qasm/fromTape";
import { importQasm } from "../src/qasm/import";
import { Register } from "../src/calc/register";
import { setCustomGates } from "../src/calc/custom";
import { TYPED_PRESETS } from "../src/ui/views";

/**
 * Every palette item is OpenQASM: placed on a generic 4-qubit state (angles
 * set away from their defaults), exported, and read back by QC-1's importer
 * to the same state. (Qiskit loads the same files and agrees to 1e-15: the
 * statevector, qiskit, blocks, typed and classical fixtures cover the gates.)
 */
function placed(p: PaletteItem, text = "") {
  const c = calc();
  c.setQubitCount(4);
  [0.7, 1.1, 0.4, 1.9].forEach((a, q) => { add(c, "ry", [q], { params: [String(a)] }); add(c, "p", [q], { params: [String(0.3 + q)] }); });
  const old = new Set(c.tape.flat().map((x) => x.id));
  if (p.kind === "gate" || p.kind === "custom") {
    expect(c.placeItem(p, 0), c.message?.text).toBe(true);
    const i = c.tape.findIndex((e) => e.some((x) => !old.has(x.id)));
    const n = c.tape[i][0].params.length;
    if (n && p.gate !== "initialize") c.setGateParams(i, c.tape[i][0].params.map((_, k) => String(0.37 + 0.21 * k)));
  } else if (p.kind === "block") {
    // Phase Estimation needs an operation: a 1-qubit gate G1 made first.
    const settings = p.block === "qpe" ? (add(c, "p", [3], { params: ["0.7"] }), c.defineGate(1), { m: "2", gate: "G1" }) : {};
    const k = c.blockSize(p.block, settings) ?? (p.block === "bell" ? 2 : 3);
    expect(c.addBlock(p.block, [...Array(k).keys()], settings), c.message?.text).toBe(true);
  } else c.addTyped(p.typed, text, 0);
  expect(c.tape.some((e) => e.some((x) => !old.has(x.id)))).toBe(true);
  return c;
}

const cases: [string, PaletteItem, string][] = PALETTE.flatMap((p) =>
  p.kind === "typed" ? TYPED_PRESETS[p.typed].map(([l, t]): [string, PaletteItem, string] => [`${p.id} ${l}`, p, t]) : [[p.id, p, ""] as [string, PaletteItem, string]]);

describe("every palette item exports to OpenQASM 3 and reads back", () => {
  test.each(cases)("%s", (_, p, text) => {
    const c = placed(p, text);
    const q = exportQasm3(c.n, c.tape, c.bits);
    const r = importQasm(q);
    setCustomGates(r.gates); // the file's own definitions, as a load registers them
    try {
      const b = new Register(r.n, r.tape).state, a = stateOf(c);
      let err = 0;
      for (let k = 0; k < a.length; k++) err = Math.max(err, Math.abs(a[k] - b[k]));
      expect(err, q).toBeLessThan(1e-9);
    } finally {
      setCustomGates(c.customGates);
    }
  });
});
