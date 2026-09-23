import { readFileSync } from "node:fs";
import type { Entry } from "../../src/calc/steps";

/** A committed reference fixture (see validation/README.md). */
export type Fixture<E> = {
  meta: { group: string; reference: string; versions: Record<string, string>; tol: { abs: number } };
  cases: ({ id: string; n: number; tape: Entry[]; expected: E } & Record<string, unknown>)[];
};

export function loadFixture<E>(group: string): Fixture<E> {
  return JSON.parse(readFileSync(new URL(`../fixtures/${group}.json`, import.meta.url), "utf8"));
}

export type CVec = { re: number[]; im: number[] };

/** Largest |a − b| between a QC-1 interleaved state and a fixture vector. */
export function maxDiff(state: Float64Array, v: CVec): number {
  let m = 0;
  for (let i = 0; i < v.re.length; i++) {
    m = Math.max(m, Math.hypot(state[2 * i] - v.re[i], state[2 * i + 1] - v.im[i]));
  }
  return m;
}
