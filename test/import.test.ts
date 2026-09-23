import { describe, test, expect } from "vitest";
import { Register } from "../src/calc/register";
import { exportQasm3 } from "../src/qasm/fromTape";
import { importQasm, QasmImportError } from "../src/qasm/import";
import { setCustomGates, type CustomGate } from "../src/calc/custom";
import type { Entry } from "../src/calc/steps";
import { loadFixture } from "./validated/fixtures";
import { POINTS } from "../validation/cases/groups/symbolic";

type Case = { id: string; n: number; tape: Entry[]; gates?: CustomGate[] };

/** Export, import, replay: the same state (global phase included), and the same classical bits. */
function roundTrip(c: Case, scope: Record<string, number> = {}) {
  setCustomGates(c.gates ?? []);
  const a = new Register(c.n, c.tape, scope);
  const q = exportQasm3(c.n, c.tape);
  const r = importQasm(q);
  setCustomGates([...(c.gates ?? []).filter((g) => !r.gates.some((x) => x.name === g.name)), ...r.gates]);
  expect(r.n).toBe(c.n);
  const b = new Register(r.n, r.tape, scope);
  let err = 0;
  for (let i = 0; i < a.state.length; i++) err = Math.max(err, Math.abs(a.state[i] - b.state[i]));
  expect(err, q).toBeLessThan(1e-10);
  expect(Array.from(b.cbits)).toEqual(Array.from(a.cbits));
  expect(b.notes).toEqual([]); // no measurement had to be re-sampled
}

describe("QASM export → import round trip", () => {
  for (const group of ["gates", "random-tapes", "classical", "structure"]) {
    const fx = loadFixture<Case>(group);
    test(`${group} (${fx.cases.length} tapes)`, () => {
      for (const c of fx.cases) roundTrip(c as Case);
    });
  }
  test("symbolic tapes, at every validation point", () => {
    const fx = loadFixture<Case>("symbolic");
    for (const c of fx.cases) for (const p of POINTS) roundTrip(c as Case, p);
  });
});

describe("QASM import", () => {
  test("registers, broadcast, modifiers, if/else on a named bit register", () => {
    const r = importQasm(`OPENQASM 3.0;
include "stdgates.inc";
qubit[2] a; qubit b; bit[1] m;
h a;
negctrl @ ctrl @ x a[0], a[1], b;
inv @ s b;
pow(2) @ t a[0];
m[0] = measure a[1];
if (m[0] == 1) { x b; } else z b;`);
    expect(r.n).toBe(3);
    expect(r.tape[0].map((s) => s.targets[0])).toEqual([0, 1]); // broadcast H: one ALL-like entry
    expect(r.tape[1][0]).toMatchObject({ gateId: "x", controls: [0, 1], targets: [2], controlStates: [false, true] });
    expect(r.tape[2][0].gateId).toBe("sdg");
    expect(r.tape.slice(3, 5).map((e) => e[0].gateId)).toEqual(["t", "t"]);
    expect(r.tape[6][0].condition).toEqual({ clbit: 1, value: 1 });
    expect(r.tape[7][0]).toMatchObject({ gateId: "z", condition: { clbit: 1, value: 0 } });
  });

  test("a gate definition becomes a custom gate; a mismatched native name is kept as defined", () => {
    const r = importQasm(`OPENQASM 3.0; include "stdgates.inc";
gate bell a, b { h a; cx a, b; }
gate rzz(th) a, b { cx a, b; rz(th) b; cx a, b; }
qubit[3] q; bell q[0], q[2]; rzz(0.4) q[0], q[1];`);
    expect(r.gates.map((g) => [g.name, g.k])).toEqual([["bell", 2]]);
    expect(r.tape[0][0].gateId).toBe("custom:bell");
    expect(r.tape[1][0].gateId).toBe("rzz"); // same matrix as QC-1's: native
  });

  test("hostile expressions are refused", () => {
    expect(() => importQasm(`OPENQASM 3.0; qubit[1] q; rz(this.constructor) q[0];`)).toThrow(QasmImportError);
    expect(() => importQasm(`OPENQASM 3.0; qubit[1] q; rz("x") q[0];`)).toThrow();
  });
});

import { shareHash, readShareHash } from "../src/qasm/share";

describe("share links", () => {
  test("#z= carries the compressed program and symbol values; reading it back imports the same tape", async () => {
    const fx = loadFixture<Case>("symbolic");
    const c = fx.cases[0] as Case;
    const scope = { theta: 0.37, phi: -1.2, lambda: 2.1, t: 1.1 };
    const hash = await shareHash(c.n, c.tape, scope);
    expect(hash.startsWith("#z=")).toBe(true);
    const back = (await readShareHash(hash))!;
    expect(back.scope).toEqual(scope);
    expect(back.qasm).toBe(exportQasm3(c.n, c.tape));
    const r = importQasm(back.qasm);
    const a = new Register(c.n, c.tape, scope), b = new Register(r.n, r.tape, back.scope);
    let err = 0;
    for (let i = 0; i < a.state.length; i++) err = Math.max(err, Math.abs(a.state[i] - b.state[i]));
    expect(err).toBeLessThan(1e-10);
  });

  test("links from before compression (#q=, plain text) still open", async () => {
    const text = exportQasm3(2, [[{ id: "a", gateId: "h", column: 0, controls: [], targets: [0], clbits: [], params: [] }]]);
    const q = btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect((await readShareHash(`#q=${q}&v=theta:2`))).toEqual({ qasm: text, scope: { theta: 2 } });
  });

  test("garbage in the fragment is ignored; a link can't inflate past 1 MB", async () => {
    expect(await readShareHash("#q=%%%")).toBeNull();
    expect(await readShareHash("#z=AAAA")).toBeNull();
    expect(await readShareHash("#x=1")).toBeNull();
    expect((await readShareHash("#q=AAAA&v=__proto__:1,theta:2"))!.scope).toEqual({ theta: 2 });
    // 2 MB of spaces deflates to a few KB: refused.
    const bomb = new Uint8Array(await new Response(new Blob([" ".repeat(2 << 20)]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    let bin = "";
    for (const b of bomb) bin += String.fromCharCode(b);
    expect(await readShareHash(`#z=${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`)).toBeNull();
  });
});
