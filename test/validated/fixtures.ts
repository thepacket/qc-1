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

/**
 * Recursive numeric comparison against a fixture value. `tols` gives a
 * per-field tolerance by key name (e.g. concurrence); everything else uses
 * `tol`, scaled by max(1, |expected|). Returns mismatching paths.
 */
export function deepClose(a: unknown, b: unknown, tol: number, tols: Record<string, number> = {}, path = "$"): string[] {
  if (b === null || a === null || b === undefined) return a === b || (a == null && b == null) ? [] : [`${path}: ${String(a)} vs ${String(b)}`];
  if (Array.isArray(b)) {
    if (!Array.isArray(a) || a.length !== b.length) return [`${path}: length ${Array.isArray(a) ? a.length : "?"} vs ${b.length}`];
    return b.flatMap((y, i) => deepClose(a[i], y, tol, tols, `${path}[${i}]`));
  }
  if (typeof b === "object") {
    return Object.keys(b as object).flatMap((k) =>
      deepClose((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tols[k] ?? tol, tols, `${path}.${k}`),
    );
  }
  if (typeof b === "number") {
    const x = Number(a);
    return Math.abs(x - b) <= tol * Math.max(1, Math.abs(b)) ? [] : [`${path}: ${x} vs ${b}`];
  }
  return a === b ? [] : [`${path}: ${String(a)} vs ${String(b)}`];
}
