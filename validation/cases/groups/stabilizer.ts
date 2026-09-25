import type { Entry, Step } from "../../../src/calc/steps";
import { qiskitGenerators } from "../../../src/calc/order";
import { StabilizerRegister } from "../../../src/stab/register";
import { Register } from "../../../src/calc/register";
import { rng, step } from "../tapes";

export type StabCase = { id: string; n: number; tape: Entry[] };

/** Every kind of Clifford step QC-1 has: Paulis, H, S(†), √X(†), √Y(†), SWAP, iSWAP, DCX, ECR, CX/CY/CZ with anti-controls, π/2 rotations. */
function cliffordStep(r: ReturnType<typeof rng>, n: number): Step {
  const q = r.int(n), o = (q + 1 + r.int(n - 1)) % n;
  const u = r.int(13);
  switch (u) {
    case 0: return step(r.pick(["x", "y", "z", "h", "s", "sdg", "sx", "sxdg", "sy", "sydg", "i"]), [q]);
    case 1: return step(r.pick(["rx", "ry", "rz", "p"]), [q], [], [r.pick(["π/2", "-π/2", "π", "3*π/2"])]);
    case 2: return step(r.pick(["swap", "iswap", "dcx", "ecr"]), [q, o]);
    case 3: return step(r.pick(["x", "y", "z"]), [o], [q], [], [r.next() < 0.4]);
    case 4: return step(r.pick(["rxx", "ryy", "rzz", "rzx"]), [q, o], [], [r.pick(["π/2", "-π/2"])]);
    case 5: return step("u", [q], [], [r.pick(["π/2", "π"]), r.pick(["0", "π/2", "π"]), r.pick(["0", "-π/2", "π"])]);
    default: return step(r.pick(["h", "s", "x", "sx"]), [q]);
  }
}

export function largeCases(): StabCase[] {
  const r = rng(1024);
  return [30, 64, 128, 200].map((n, k) => ({ id: `n${n}`, n, tape: Array.from({ length: 4 * n }, () => [cliffordStep(r, n)]) as Entry[] }));
}

/** Small tapes with measurements, resets, preps and IF: checked against the statevector. */
export function smallCases(): StabCase[] {
  const r = rng(2048);
  const out: StabCase[] = [];
  for (let k = 0; k < 12; k++) {
    const n = 2 + (k % 5);
    const tape: Entry[] = [];
    for (let d = 0; d < 20; d++) {
      const u = r.next();
      const q = r.int(n);
      if (u < 0.12) tape.push([step(r.pick(["measure", "measure_x", "measure_y", "reset"]), [q])]);
      else if (u < 0.17) tape.push([step(r.pick(["init1", "initplus", "initiminus"]), [q])]);
      else if (u < 0.22) tape.push([{ ...cliffordStep(r, n), condition: { clbit: r.int(n), value: r.int(2) } }]);
      else tape.push([cliffordStep(r, n)]);
    }
    out.push({ id: `m${k}`, n, tape });
  }
  // Record outcomes on the statevector (seeded), then replay them on the tableau.
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return out.map((c) => {
    const reg = new Register(c.n);
    for (const e of c.tape) reg.push(e, rnd);
    return { ...c, tape: reg.tape };
  });
}

export function compute(c: StabCase) {
  const reg = new StabilizerRegister(c.n, c.tape);
  return { generators: qiskitGenerators(reg.tab.stabilizers()), notes: reg.notes, cbits: Array.from(reg.cbits), state: c.n <= 20 ? Array.from(new Register(c.n, c.tape).state) : null };
}
