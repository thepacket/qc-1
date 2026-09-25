import { LearningPath } from "./LearningPath";
import type { Calculator } from "../calc/calculator";
import { CATEGORIES, analysesIn } from "../analysis/catalog";
import { PALETTE_GROUPS } from "../calc/gateSpecs";
import { BLOCKS, FAMILIES } from "../calc/blockLib";
import { TOMO_MAX } from "../calc/tomography";

/** Phone-first help: building a circuit, editing it, the views, LAB, conventions. */
export function HelpView({ calc }: { calc: Calculator }) {
  return (
    <div className="view">
      <div className="view-head lab-head">
        <button className="back" onClick={() => calc.toggleHelp()} aria-label="Close help">‹</button>
        <span>Help</span>
      </div>
      <div className="rows lab-body help">
        <LearningPath />
        <h3>Building a circuit</h3>
        <p>In the <b>CIRCUIT</b> tab, the gate palette sits under the diagram. The diagram is a grid: a column for each time step, a row for each qubit. <b>Drag a gate up into a cell</b> and let go: it lands in that column (or the first free one to its right) and stays there. A dashed outline shows where. A gate on k qubits takes k wires from the one you drop it on (controls first).</p>
        <p>Or <b>tap an empty cell</b>, then tap gates in the palette: they fill that wire left to right. Without a chosen cell, a tapped gate goes after the last gate on the selected wire.</p>
        <p>Palette groups: {PALETTE_GROUPS.map((g) => g.label).join(" · ")}. Search finds a gate by name. <b>State…</b> and <b>Matrix…</b> take what you type (a ket like |00⟩ + |11⟩, or a unitary) and turn it into a gate.</p>
        <p><b>Blocks</b>, grouped by what they are for ({FAMILIES.map((f) => f.label).join(" · ")}): {BLOCKS.map((b) => b.name).join(", ")}. Each is named after an object in Qiskit's circuit library and checked against it exactly, global phase included (Bell and GHZ, which Qiskit has no object for, against their states); the settings sheet names the object. A block asks for its qubits and settings and goes in as one gate (NAMEk: QFT3, GROVER3, REALAMP4…); its parameters are symbols (θ₀, θ₁…, γ₀, β₀…) you set in PARAM. Long-press it to see its settings, <b>expand</b> it into its gates, or <b>invert</b> it (QFT ↔ QFT†, others NAME_DG); it takes controls like any gate. The measuring blocks (Pauli Measurement, Hadamard Test, Swap Test, Repetition Syndrome) go in as their steps, with their ancilla last: 1 − 2·P(1) is the value they estimate.</p>
        <p>Classical bits: <b>− k +</b> beside the qubits. They are a register of their own, one lane per bit under the wires (c0, c1, …): a measurement's link comes down to the lane of the bit it writes (its own qubit's by default), and a gate set to run "only if c[k] = v" hangs from its bit's lane on a dotted line. Drag the dot on a lane to another lane to change the bit (or pick it in the long-press menu). Several measurements may write one bit, and there can be more bits than qubits or fewer.</p>
        <p>Qubits: <b>− n +</b> at the top, or tap the number and type it. Up to 20 qubits run on the statevector; above that (to 1024) a stabilizer tableau runs Clifford gates only.</p>
        <h3>Editing on the diagram</h3>
        <p><b>Drag a gate</b> to another column or wire; drop it on the <b>trash</b> (over the palette while you drag) to delete it. Nothing else moves: gates keep their columns. <b>Drag a control dot</b> to another wire, or onto the trash to remove it. <b>Tap a gate</b> to select it: its targets become dots to drag too, and its <b>● +</b> handle adds a control where you drop it.</p>
        <p><b>Long-press a gate</b> (right-click with a mouse) for its menu: its angles (type <b>pi/2</b>, <b>2*theta</b>, <b>t</b>, <b>sqrt(2)</b>…), duplicate, invert, expand a block into its gates, add or remove a control, flip a control between ● (fires on |1⟩) and ○ (on |0⟩), run it only if a classical bit c[k] = v, choose which bit a measurement writes, put a one-qubit gate on every qubit, delete.</p>
        <p><b>Long-press empty space</b> (right-click with a mouse) for the <b>Edit</b> and <b>Transform</b> menus. Edit: undo, redo; copy the circuit as OpenQASM or paste one; copy, cut, paste, repeat ×N or fold the selected gates, or save them as one gate G# in their place; insert a block (opens the palette's Blocks); clear. Transform: compact, append U†, optimise, a random Clifford circuit, transpile or compile to Clifford+T, IBM or Rigetti gates, route onto a line, ring or grid. A transform replaces the circuit only once it is checked (the same operator), and UNDO takes it back.</p>
        <p>To select gates, long-press empty space and keep holding while you drag a rectangle (a mouse just drags). Long-press the selection for the same menus.</p>
        <p>↶ ↷ at the top undo and redo every edit. With a keyboard: Ctrl+Z / Ctrl+Shift+Z, Ctrl+C / X / V, Ctrl+A, Ctrl+D (duplicate), Delete, arrows (move the selected gate), Esc.</p>
        <p>Symbols: an angle that names one (t, theta, phi…) makes it a parameter. The symbol badge at the top opens sliders, exact values, t playback and ● REC (one period of t as a video).</p>
        <h3>The circuit tab's MENU</h3>
        <p>Examples, OpenQASM import and export, Qiskit (Python) export, share links and QR codes, a printable report, <b>Memory</b> (save circuits in M1–M9 and load them back), <b>Define gate</b> (the last steps as a gate of your own, then under "Your gates" in the palette) and Clear circuit.</p>
        <p>The scrubber shows the state after any step (or tap a step in STEP); editing the circuit goes back to the live state.</p>
        <h3>Views</h3>
        <p><b>CIRCUIT</b> the menu of examples, import and export (MENU), the diagram (CIRCUIT), the numbered steps (STEP) and the OpenQASM (QASM) · <b>STATE</b> amplitudes, or density matrix and purity under noise · <b>PROB</b> probabilities · <b>BLOCH</b> one sphere per qubit · <b>SHOTS</b> sampled counts (type the number of shots; re-roll) · <b>LAB</b> analyses and tools (PIN adds a result to the report).</p>
        <p><b>Hardware experiment</b> shows simulated measurement results. Choose <b>Run once</b> for a new sample, or enable <b>auto-refresh</b> at the rate you set (runs per second), whichever tab is open. A run is a set of experiments of N shots each. The Z experiment is the SHOTS sample: PROB shows its frequencies with their standard errors, and the LAB panels that read only Z-basis probabilities use it. Measuring every qubit in X and in Y gives BLOCH's x and y (z from Z), each with its error. Up to {TOMO_MAX} qubits, state tomography measures all 3ⁿ Pauli settings (linear inversion, then the nearest physical ρ): Under noise, STATE shows reconstructed ρ̂ and purity, with an optional leading eigenvector; supported LAB panels use the full mixed matrix. Without noise, STATE shows the leading component. Above {TOMO_MAX} qubits full tomography reports its limit under noise; without noise STATE shows √frequency. Panels that only need a few qubits' density matrices (density, mutual information, negativity, concurrence, discord, tripartite information, phase disks) see the measured, mixed ρ of those qubits, at any size: from the full tomography up to {TOMO_MAX} qubits, else by local tomography of each subset they need (with noise on, from the model's density matrix up to 10 qubits, then from noise trajectories within a work budget). In stabilizer mode (above 20 qubits) PROB and BLOCH are estimated from shots too; STATE's generators stay exact. Numbers in LAB get ± error bars from a bootstrap (the counts resampled and the panel re-run). Panels that don't read the state (circuit structure, tools, noise model, benchmarks) are experiments of their own and don't change. With noise on, every experiment samples the noisy circuit: the basis changes before measuring (H, S†) carry their gates' noise, and readout errors can be asymmetric (a 1 misread as 0 more often than a 0 as 1, set in the noise model or read from a device file); <b>mitigate readout</b> undoes the confusion matrix on every count. Stopping auto-refresh keeps the sampled results. Switch to Simulation for direct calculations. Result labels identify the calculation or reconstruction method; bitstrings display their qubit order, with q0 on the right.</p>
        <p>Turn the phone sideways: the display on the left, the palette on the right.</p>
        <p>Direct noisy STATE and full mixed-state LAB analyses support up to 8 qubits (mixed QFI: 6). Local-density panels can handle larger circuits within their panel limits and a trajectory work budget; results show the actual trajectory count, and trajectory uncertainty is not included in error bars. STATE previews at most 8 × 8 matrix entries. Purity uses the full matrix. Unsupported pure-state analyses report their limitation under noise. Reduced-density plots label the bit order of the selected qubits.</p>
        <h3>Examples, step by step</h3>
        <p>MENU → Examples: tap a program, then <b>▶ step through</b>. It loads at the start; ◀ ▶ under the display walk the steps with the program's own comments, in any view. ✕ ends it.</p>
        <h3>LAB</h3>
        <ul>
          {CATEGORIES.map((c) => <li key={c.id}>{c.label} <span className="dim">· {analysesIn(c.id).length}</span></li>)}
        </ul>
        <p>Some analyses appear in more than one group (OTOCs under Dynamics and Chaos, the QGT under Metrology and Geometry). The search field at the top of LAB finds an analysis by name, summary or group; ☆ on an analysis screen adds it to ★ Favourites, and the last ones you opened are under Recent.</p>
        <p>Noise: LAB → Noise &amp; error → Noise model (Qiskit Aer conventions). With noise on, Prob, Bloch, Shots and the noise and benchmarking analyses use it.</p>
        <h3>AI chat</h3>
        <p>The <b>AI</b> button opens a chat with a model of your choice through OpenRouter, using your own API key (stored on this device only). It reads the circuit and state and runs LAB analyses; a circuit it suggests comes with APPLY, and UNDO takes it back.</p>
        <h3>Conventions</h3>
        <p>Bit order as in Qiskit: qubit q is bit q of a basis index, so q0 is the <b>rightmost</b> (least significant) character of a ket |q(n−1)…q1 q0⟩, of shot bitstrings and of classical bits (c[k−1]…c[0]). Pauli strings too: <b>IIZ</b> is Z on q0. A typed matrix is read as Qiskit's Operator (its index's bit j is the j-th qubit it is placed on), and QFT blocks are Qiskit's QFTGate. Angles are in radians; RX(θ) = e^(−iθX/2) as in Qiskit. (Circuits and OpenQASM files are the same in any order; before this, QC-1 wrote q0 leftmost, and the DCX and ECR gates had their two qubits' roles swapped relative to Qiskit's.)</p>
        <h3>Checking the numbers</h3>
        <p>Every simulation path and analysis is checked against Qiskit, Qiskit Aer, numpy or scipy references (the repository's validation suite). LAB → Verification &amp; export → Self-test replays those references on this device.</p>
        <p className="dim">QC-1 · MIT license · © 2026 Andre Paquette</p>
      </div>
    </div>
  );
}
