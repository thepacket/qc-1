import { describe, test, expect } from "vitest";
import { compute } from "../../validation/cases/groups/tools";
import type { Entry } from "../../src/calc/steps";
import { loadFixture } from "./fixtures";

// References: Qiskit Operator equivalence of every tool's output (up to global
// phase and the routing permutation), native-basis counts and count_ops/depth
// resources (validation/ref/g_tools.py). The fixture replays the recorded tape.
type ToolRef = { equal: boolean; perm: number[] | null; nonNative: number | null; resources: Record<string, number> };
const fx = loadFixture<{ n: number; tape: Entry[]; resources: Record<string, number>; tools: Record<string, ToolRef> }>("tools");

describe(`tools (vs ${fx.meta.reference})`, () => {
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const mine = compute({ id: c.id, n: c.n, tape: c.tape }) as unknown as {
      resources: Record<string, unknown>; tools: Record<string, ToolRef & { resources: Record<string, unknown> }>;
    };
    const pick = (r: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, r[k]]));
    expect(pick(mine.resources, Object.keys(c.resources))).toEqual(c.resources);
    expect(Object.keys(mine.tools).sort()).toEqual(Object.keys(c.tools).sort());
    for (const [name, ref] of Object.entries(c.tools)) {
      const t = mine.tools[name];
      expect(t.equal, name).toBe(true);
      expect(t.perm, name).toEqual(ref.perm);
      expect(t.nonNative, name).toBe(ref.nonNative);
      expect(pick(t.resources, Object.keys(ref.resources)), name).toEqual(ref.resources);
    }
  });
});

// Structure analyses on Clifford tapes with mid-circuit measurements:
// count_ops/depth, DAG ancestors per measurement, stabilizer generators that
// fix Qiskit's post-selected state (validation/ref/g_tools.py).
import { computeStructure } from "../../validation/cases/groups/tools";
type StructRef = { n: number; tape: Entry[]; resources: Record<string, number>; interaction: number[][]; tanner: unknown; generators: string[] };
const sx = loadFixture<StructRef>("structure");

describe(`structure (vs ${sx.meta.reference})`, () => {
  test.each(sx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const mine = computeStructure({ id: c.id, n: c.n, tape: c.tape });
    const res = mine.resources as unknown as Record<string, unknown>;
    expect(Object.fromEntries(Object.keys(c.resources).map((k) => [k, res[k]]))).toEqual(c.resources);
    expect(mine.interaction).toEqual(c.interaction);
    expect(mine.tanner).toEqual(c.tanner);
    expect(mine.generators).toEqual(c.generators);
  });
});
