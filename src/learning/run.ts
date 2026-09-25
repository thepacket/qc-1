import { Calculator } from "../calc/calculator";
import { InlineEngine } from "../calc/engine";
import { DEFAULT_NOISE } from "../noise/model";
import { lessonQasm, type Lesson, type LessonVariant } from "./lessons";

/** A small, isolated practice circuit; never mutates the user's calculator. */
export async function runLesson(lesson: Lesson, variant: LessonVariant, seed: number) {
  const engine = new InlineEngine();
  const calc = new Calculator(engine);
  calc.loadQasm(lessonQasm(lesson, variant), "practice");
  const request = { shots: 512, shotSeed: seed };
  let prob = engine.core.view({ ...request, mode: "prob" });
  let shots = engine.core.view({ ...request, mode: "shots" });
  let bloch = engine.core.view({ ...request, mode: "bloch" });
  if (variant.damping) {
    const { noisyView } = await import("../analysis/noiseRuns");
    const ctx = { ...engine.core.snapshot(), noise: { ...DEFAULT_NOISE, enabled: true, p1: 0, p2: 0, readout: 0, ad: variant.damping } };
    const result = await Promise.all((["prob", "shots", "bloch"] as const).map(mode => noisyView(ctx, { mode, shots: 512, seed })));
    if (result.some(r => !r.view || r.error)) throw new Error("Practice calculation failed.");
    [prob, shots, bloch] = result.map(r => r.view!);
  }
  if (prob.mode !== "prob" || shots.mode !== "shots" || bloch.mode !== "bloch") throw new Error("Unexpected practice result.");
  return { source: prob.provenance, x: bloch.vectors[0].x, shots: shots.shots,
    rows: Array.from({ length: 2 ** lesson.n }, (_, i) => ({ bits: i.toString(2).padStart(lesson.n, "0"), p: prob.rows.find(r => r.i === i)?.p ?? 0, count: shots.rows.find(r => r.i === i)?.count ?? 0 })) };
}
