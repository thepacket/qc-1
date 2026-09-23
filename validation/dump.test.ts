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
});
