import type { Calculator } from "../calc/calculator";
import { KEYPAD } from "./keys";
import { ANALYSES, CATEGORIES } from "../analysis/catalog";

/** Phone-first help: keys, 2ND functions (from the keypad), views, LAB, conventions. */
export function HelpView({ calc }: { calc: Calculator }) {
  const shifted = KEYPAD.filter((k) => k.alt);
  return (
    <div className="view">
      <div className="view-head lab-head">
        <button className="back" onClick={() => calc.toggleHelp()} aria-label="Close help">‹</button>
        <span>Help</span>
      </div>
      <div className="rows lab-body help">
        <h3>Keying gates</h3>
        <p>Select a qubit with ◀ ▶ (or tap it), press a gate key. Rotations take the angle typed first: <b>3 π ÷ 4 RX</b>. Separate several arguments with <b>,</b>.</p>
        <p><b>CTRL</b> marks the selected qubit as a control (2ND: ○CTRL, an anti-control); two-qubit gates take the last mark as their partner. <b>ALL</b> applies the next one-qubit gate to every qubit. <b>=</b> repeats the last entry. <b>AC</b> clears the entry and marks, then resets the register (UNDO brings it back).</p>
        <p>Qubits: type n, then <b>2ND Q</b> (N). Up to 20 qubits run on the statevector; above that (to 1024) a stabilizer tableau runs Clifford gates only.</p>
        <h3>Second functions (2ND)</h3>
        <div className="help-grid">
          {shifted.map((k) => <span key={k.id}><b>{k.alt}</b> <span className="dim">on {k.label}</span></span>)}
        </div>
        <p><b>t</b> and <b>VAR</b> (repeat to cycle θ φ λ α β γ δ τ ω) put symbols into angles; tap the symbol badge for sliders and t playback. <b>STO</b>/<b>RCL</b> with a digit 1–9 store and recall whole tapes. <b>IF</b> with k (or k,v) makes the next gate run only when bit c[k] = v; measuring qubit q writes c[q]. <b>CAT</b> lists every other gate, custom gates and DEFINE.</p>
        <h3>Views</h3>
        <p><b>KET</b> amplitudes · <b>PROB</b> probabilities · <b>BLOCH</b> one sphere per qubit · <b>SHOTS</b> sampled counts (tap again to re-roll) · <b>TAPE</b> the recorded steps, a scrubber to look at the state after any step, and ≡ for examples, OpenQASM import/export, Qiskit (Python) export and share links · <b>LAB</b> analyses and tools.</p>
        <h3>LAB</h3>
        <ul>
          {CATEGORIES.map((c) => <li key={c.id}>{c.label} <span className="dim">· {ANALYSES.filter((a) => a.category === c.id).length}</span></li>)}
        </ul>
        <p>Noise: LAB → Noise &amp; error → Noise model (Qiskit Aer conventions). With noise on, PROB, BLOCH, SHOTS and the noise and benchmarking analyses use it.</p>
        <h3>Conventions</h3>
        <p>q0 is the leftmost (most significant) bit of |q0 q1 …⟩. Qiskit prints bitstrings the other way round (q0 rightmost); the exports take care of it. Angles are in radians; RX(θ) = e^(−iθX/2) as in Qiskit.</p>
        <h3>Checking the numbers</h3>
        <p>Every simulation path and analysis is checked against Qiskit, Qiskit Aer, numpy or scipy references (the repository's validation suite). LAB → Verification &amp; export → Self-test replays those references on this device.</p>
        <p className="dim">QC-1 · MIT license · © 2026 Andre Paquette</p>
      </div>
    </div>
  );
}
