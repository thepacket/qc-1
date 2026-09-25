import { useState } from "react";
import { LESSONS } from "../learning/lessons";
import type { runLesson } from "../learning/run";
import { BitOrder, ResultSource } from "./ResultContext";

type Results = Awaited<ReturnType<typeof runLesson>>[];
export function LearningPath() {
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState(0);
  const lesson = LESSONS[index];
  const move = (i: number) => { setIndex(i); setChoice(null); setResults(null); setError(""); };
  const execute = async () => {
    setBusy(true); setError("");
    try {
      const { runLesson } = await import("../learning/run");
      setResults(await Promise.all(lesson.variants.map(v => runLesson(lesson, v, run + 1))));
      setRun(run + 1);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section className="learning-path" aria-label="Guided learning path">
    <h3>Learn by predicting</h3>
    <p>Six short experiments in a separate practice circuit. Your circuit stays in place.</p>
    <nav className="lesson-nav" aria-label="Lessons">{LESSONS.map((l, i) => <button key={l.id} disabled={busy} aria-pressed={i === index} onClick={() => move(i)}>{i + 1}. {l.title}</button>)}</nav>
    <h4>{index + 1} / {LESSONS.length} · {lesson.title}</h4>
    <p>{lesson.question}</p>
    <fieldset disabled={busy || !!results}><legend>Your prediction</legend>{lesson.choices.map((c, i) => <label key={c}><input type="radio" name="prediction" checked={choice === i} onChange={() => setChoice(i)} /> {c}</label>)}</fieldset>
    <button disabled={choice === null || busy} onClick={() => void execute()}>{busy ? "Running…" : results ? "Run again (512 shots)" : "Run experiment (512 shots)"}</button>
    {error && <p role="alert">{error}</p>}
    {results && <div aria-live="polite">
      <p><b>{choice === lesson.answer ? "Your prediction matches." : "Compare your prediction with the result."}</b> {lesson.explanation}</p>
      {results.map((r, i) => <section key={i} className="lesson-result"><h4>{lesson.variants[i].label}</h4><code>{lesson.variants[i].gates}</code><ResultSource source={r.source && { method: `Calculated probabilities: ${r.source.method}`, detail: "Counts are a separate sample of 512 simulated Z measurements." }} /><BitOrder n={lesson.n} />
        <table><thead><tr><th>Outcome</th><th>Calculated</th><th>Counts / {r.shots}</th></tr></thead><tbody>{r.rows.map(row => <tr key={row.bits}><td>{row.bits}</td><td>{(100 * row.p).toFixed(1)}%</td><td>{row.count}</td></tr>)}</tbody></table>
        {lesson.id === "phase" && <p>Calculated ⟨X on q0⟩ = {r.x.toFixed(2)}</p>}
      </section>)}
      {index < LESSONS.length - 1 ? <button disabled={busy} onClick={() => move(index + 1)}>Next lesson →</button> : <p>This is the final lesson. Revisit any topic above, try changing a circuit in CIRCUIT, or explore the questions in LAB.</p>}
    </div>}
  </section>;
}
