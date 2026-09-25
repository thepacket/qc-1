# QC-1 help

The same help is in the app (the **?** button in the display's header).

- [LAB analyses](analyses.md): every analysis and tool, generated from the registry.
- Keys: select a qubit with ◀ ▶, press a gate key. Angles are typed first (`3 π ÷ 4 RX`), several arguments separated by `,`. **CTRL** marks controls (2ND: anti-controls); two-qubit gates take the last mark as their partner. **ALL** applies the next one-qubit gate to every qubit; **=** repeats the last entry; **UNDO / REDO**; **AC** clears the entry, then resets the register (undoable).
- 2ND functions are printed above each key: N− / N+ / N (register size), REDO, ○CTRL, CAT (catalog, custom gates, DEFINE), iSWAP, RST, √Y, MX, MY, IF, √X†, S†, T†, RXX, RYY, RZZ, sin / cos / exp, parentheses, U, +, √, RCL, t, VAR, STO.
- Symbols: `t` and the VAR letters (θ φ λ α β γ δ τ ω) in angles; the symbol badge opens sliders and t playback. STO / RCL with a digit 1–9 store whole circuits.
- Classical control: a classical register of its own (− k + at the top); a measurement writes a bit (its qubit's by default, any other from its long-press menu); "only if c[k] = v" in a gate's long-press menu makes it conditional.
- Views: KET, PROB, BLOCH, SHOTS, CIRC (gate list and diagram, scrubber, ≡ menu: examples, OpenQASM import/export, Qiskit Python export, share links), LAB.
- Up to 20 qubits the register is a statevector; above 20 (to 1024) a stabilizer tableau that takes Clifford gates only.
- Noise: LAB → Noise & error → Noise model (Qiskit Aer conventions; presets and device calibration files).
- Conventions: Qiskit's bit order — q0 is the rightmost, least significant bit of |q(n−1)…q1 q0⟩, of bitstrings and of Pauli strings (IIZ = Z on q0); classical bits print c[k−1]…c[0]. Typed matrices follow Qiskit's Operator convention; blocks are named after Qiskit circuit-library objects and checked against them exactly (QFT blocks are Qiskit's QFTGate); DCX and ECR are Qiskit's gates. RX(θ) = e^(−iθX/2), as in Qiskit.
