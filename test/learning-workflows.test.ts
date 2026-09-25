import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LESSONS } from "../src/learning/lessons";
import { runLesson } from "../src/learning/run";
import { LAB_QUESTIONS } from "../src/analysis/questions";
import { ANALYSIS_BY_ID } from "../src/analysis/catalog";
import { runAnalysis } from "../src/analysis/run";
import { BitOrder, pauliMeaning } from "../src/ui/ResultContext";
import { ProbView } from "../src/ui/views";
import { calc } from "./ed";

const probabilities = [ [[0.5, 0.5]], [[0.5, 0.5], [0.5, 0.5]], [[1, 0], [0, 1]], [[0.5, 0, 0, 0.5]], [[1, 0], [0.5, 0.5]], [[0, 1], [0.3, 0.7]] ];

test.each(LESSONS.map((lesson, index) => ({ lesson, index })))("practice: $lesson.title runs the displayed circuit and supports its explanation", async ({ lesson, index }) => {
  for (const [j, variant] of lesson.variants.entries()) {
    const result = await runLesson(lesson, variant, 7);
    result.rows.forEach((r, k) => {
      expect(r.p).toBeCloseTo(probabilities[index][j][k], 10);
      expect(r.count / result.shots).toBeCloseTo(r.p, 1);
    });
    expect(result.rows.reduce((sum, r) => sum + r.count, 0)).toBe(512);
    if (lesson.id === "phase") expect(result.x).toBeCloseTo(j === 0 ? 1 : -1, 10);
    if (variant.damping) expect(result.source?.method).toBe("Exact density-matrix simulation");
  }
});

test("practice leaves the user's asymmetric typed state and custom gate definitions intact", async () => {
  const c = calc(); c.setQubitCount(3); c.addTyped("state", "|01>", 1);
  c.setMode("prob");
  const saved = JSON.stringify(c.save());
  await runLesson(LESSONS[5], LESSONS[5].variants[1], 3);
  expect(JSON.stringify(c.save())).toBe(saved);
  c.setMode("ket"); c.setMode("prob");
  const view = c.view!;
  if (view.mode !== "prob") throw new Error("expected probabilities");
  expect(view.rows.find(r => r.i === 2)?.p).toBeCloseTo(1, 12);
  const html = renderToStaticMarkup(createElement(ProbView, { calc: c, data: view }));
  expect(html).toContain("|010⟩");
  expect(renderToStaticMarkup(createElement(BitOrder, { n: 3 }))).toContain("q2 q1 q0");
});

test("LAB input → normalized Pauli → asymmetric result → observable label → sampled mixed result", async () => {
  const c = calc(null, runAnalysis);
  c.loadQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; x q[0];', "asymmetric");
  c.setMode("lab");
  c.setLabOpts("expectation", { obs: " i i z + 2 * z i i " });
  c.openAnalysis("expectation");
  const exact = c.analysis!.result!;
  expect(exact.error).toBeUndefined();
  expect(exact.scalars!.find(s => s.label === "⟨H⟩")!.value).toBeCloseTo(1, 12);
  expect(pauliMeaning(" i i z + 2 * z i i ", 3)).toBe("IIZ → Z on q0; ZII → Z on q2");
  const bars = exact.charts!.find(c => c.kind === "bars")!;
  expect(bars.labels).toEqual(["IIZ", "ZII"]);
  c.setNoise({ enabled: true, p1: 0.5, p2: 0, ad: 0, pd: 0, readout: 0 });
  c.setShots(10000);
  c.setExperimentMode("hardware");
  await expect.poll(() => c.analysis?.status).toBe("done");
  await expect.poll(() => c.analysis?.result?.provenance?.method).toBe("State tomography");
  const measured = c.analysis!.result!;
  expect(measured.error).toBeUndefined();
  expect(measured.scalars!.find(s => s.label === "⟨H⟩")!.value).toBeCloseTo(1.5, 1);
  expect(measured.scalars!.find(s => s.label === "Var(H)")!.value).toBeCloseTo(0.75, 1);
  c.rerollShots();
  await expect.poll(() => c.analysis?.status).toBe("done");
  expect(c.analysis!.result!.provenance!.detail).toContain("noise model included");
});

test("question routes resolve to supported analyses and retain the technical catalog", () => {
  for (const question of LAB_QUESTIONS) for (const id of question.ids) {
    expect(ANALYSIS_BY_ID[id]).toBeDefined();
    const c = calc(); c.setMode("lab"); c.openAnalysis(id);
    expect(c.lab.id).toBe(id);
    c.labBack(); c.labBack();
    expect(c.lab.level).toBe("cats");
    expect(c.labGroups().some(g => g.items.some(a => a.id === id))).toBe(true);
  }
});

test("typed matrix on q1/q2 → displayed 010 → saved session preserves the mapped operation", () => {
  const c = calc(); c.setQubitCount(3);
  // X on the low bit of this two-qubit matrix: q1, not q0 or q2.
  c.addTyped("matrix", "0,1,0,0; 1,0,0,0; 0,0,0,1; 0,0,1,0", 1);
  c.setMode("prob");
  const view = c.view!;
  if (view.mode !== "prob") throw new Error("expected probabilities");
  expect(view.rows.find(r => r.i === 2)?.p).toBeCloseTo(1, 12);
  expect(renderToStaticMarkup(createElement(ProbView, { calc: c, data: view }))).toContain("|010⟩");
  const restored = calc(c.save()); restored.setMode("prob");
  expect(restored.view!.mode).toBe("prob");
  expect(restored.view).toEqual(view);
});
