import { VERIFY_RUNS } from "../../../src/analysis/verifyRuns";
import { Register } from "../../../src/calc/register";
import type { AnalysisResult } from "../../../src/analysis/types";
import { exportQasm3 } from "../../../src/qasm/fromTape";
import { productLayer, randomTape, rng } from "../tapes";

/** Pairs of tapes to compare: equal up to phase, slightly different, unrelated. */
export function cases() {
  const r = rng(7337);
  return [2, 3, 3].map((n, k) => {
    const a = [...productLayer(r, n), ...randomTape(r, n, 5, ["h", "x", "rz", "ry", "swap", "rzz", "t"])];
    const b = k === 0 ? a : k === 1 ? [...a, ...randomTape(r, n, 1, ["rz"])] : [...productLayer(r, n), ...randomTape(r, n, 5, ["h", "rx", "z"])];
    return { id: `pair${k}`, n, a, b };
  });
}

export async function compute(c: ReturnType<typeof cases>[number]) {
  const reg = new Register(c.n, c.a);
  const res = (await VERIFY_RUNS.compare({ n: c.n, state: reg.state, tape: c.a, scope: {} }, { slot: 1, other: { n: c.n, tape: c.b, scope: {} } })) as AnalysisResult;
  const s = Object.fromEntries((res.scalars ?? []).map((x) => [x.label, x.value]));
  return { qasmA: exportQasm3(c.n, c.a), qasmB: exportQasm3(c.n, c.b), scalars: s };
}
