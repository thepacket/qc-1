/**
 * Writes validation case bundles for the Python reference generators.
 * Runs only under vitest.validation.config.ts (`npm run validate:dump`).
 */
import { test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { Register } from "../src/calc/register";
import { exportQasm3 } from "../src/qasm/fromTape";
import { gateCases, randomCases, type Case } from "./cases/groups/statevector";
import * as ent from "./cases/groups/entanglement";
import * as st2 from "./cases/groups/state2";
import * as sym from "./cases/groups/symbolic";

const OUT = new URL("./out/", import.meta.url);

function bundle(group: string, cases: Case[]) {
  const rows = cases.map((c) => {
    const reg = new Register(c.n, c.tape);
    return { ...c, qasm: exportQasm3(c.n, c.tape), state: Array.from(reg.state) };
  });
  writeFileSync(new URL(`${group}.cases.json`, OUT), JSON.stringify({ group, cases: rows }));
}

test("dump validation cases", () => {
  mkdirSync(OUT, { recursive: true });
  bundle("gates", gateCases());
  bundle("random-tapes", randomCases());
  writeFileSync(
    new URL("entanglement.cases.json", OUT),
    JSON.stringify({
      group: "entanglement",
      cases: ent.cases().map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: ent.compute(c) })),
      page: { pairs: ent.pagePairs, qc1: ent.computePage() },
    }),
  );
  writeFileSync(
    new URL("state2.cases.json", OUT),
    JSON.stringify({
      group: "state2",
      husimi: st2.HUSIMI,
      cases: st2.cases().map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: st2.compute(c) })),
    }),
  );
  writeFileSync(
    new URL("symbolic.cases.json", OUT),
    JSON.stringify({
      group: "symbolic",
      points: sym.POINTS,
      cases: sym.cases().map((c) => ({ ...c, qasm: exportQasm3(c.n, c.tape), qc1: sym.compute(c) })),
    }),
  );
});
