# QC-1 help

Open **?** in the app for the guided learning path and detailed help.

- [Calculation modes and noise](modes.md): Direct Calculation versus Simulated Measurements, noise, shots, and auto-repeat.
- [LAB analyses](analyses.md): every analysis and tool, generated from the registry.

## Circuit editor

Drag gates from the palette onto quantum wires. The placement outline shows
where a gate will land; an occupied column moves it to the next free column.
Invalid placements are rejected. Tap empty space to choose where the next
palette gate goes.

Select a gate to edit its parameters, targets, controls, measurement destination
and classical condition. Duplicate, invert or delete it from the editor.
Undo and Redo sit beside the qubit and classical-bit counts in the top row.

Drag a rectangle over gates to select a group (on touch, long-press empty space,
then drag). Long-press the selection for copy, cut, paste, repeat, save-as-gate
and fold actions. Drag a selected gate to move the group, or use the arrow keys.
Group movement preserves internal spacing and rejects placements that would
change its shape or push unrelated gates. Edits are undoable.

Select a block and open **Inspect** to see its mapped gates without changing
the circuit. **Expand into gates** replaces the block with its constituent
gates; Undo restores it. Symbols in gate angles use the circuit's parameter
values, accessible from the parameter badge.

Quantum wires are single lines; classical lanes are double lines. Measurements
write classical bits, and conditional gates read them. Selecting a gate
highlights its associated classical lanes. Change destinations and conditions
in the gate editor or drag their connections to another classical lane.

**CIRCUIT → MENU** provides examples, OpenQASM import/export, Qiskit Python
export, share links, and circuit memory. **STEP** shows numbered entries;
**QASM** shows the program. The step slider selects a circuit prefix; move to
the last step to return to the complete circuit.

## Result panels

- **STATE:** amplitudes, or a density matrix and purity under noise. Blue cells
  are diagonal probabilities; orange cells are off-diagonal coherence. The
  optional leading eigenvector represents one component of a mixed state.
- **PROB:** probabilities or sampled frequencies, according to the chosen mode.
- **BLOCH:** rotate the main sphere by dragging or using arrow keys; **Reset
  view** restores the camera. Coordinates, explanatory notes and qubit selectors
  sit below it. Step through the circuit with the slider and arrows. Under
  noise, **Compare ideal vector** adds a dashed ideal vector and ring at the
  same circuit step. Sampled vectors have estimate labels; they do not receive
  definitive purity labels. A centered local vector alone does not establish
  entanglement.
- **SHOTS:** sampled counts and all calculation-mode, shot-count, repeat and
  rate controls. See [Calculation modes and noise](modes.md).
- **LAB:** groups and search, with Favourites and Recent for quick access.
  **Noise & error → Ideal vs noisy** compares probabilities, purity and an
  observable. Noise settings are under **Noise & error → Noise model**.

## Conventions and limits

Qiskit's bit order is used throughout: q0 is the rightmost, least significant
bit of kets, bitstrings and Pauli strings. For example, IIZ means Z on q0.
Classical bits print c[k−1]…c[0]. Matrix rows and columns follow the displayed
basis order; typed matrices use Qiskit's Operator convention.

Up to 20 qubits use a statevector; above 20 and up to 1024 use a Clifford-only
stabilizer tableau. Noise and individual analyses have smaller limits, shown
by their result or panel. Noise uses Qiskit Aer conventions and supports presets
and device calibration files. RX(θ) = exp(−iθX/2).
