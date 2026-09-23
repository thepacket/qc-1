# QC-1 help

The same help is in the app (the **?** button in the display's header).

- [LAB analyses](analyses.md): every analysis and tool, generated from the registry.
- Keys: select a qubit with ◀ ▶, press a gate key. Angles are typed first (`3 π ÷ 4 RX`), several arguments separated by `,`. **CTRL** marks controls (2ND: anti-controls); two-qubit gates take the last mark as their partner. **ALL** applies the next one-qubit gate to every qubit; **=** repeats the last entry; **UNDO / REDO**; **AC** clears the entry, then resets the register (undoable).
- 2ND functions are printed above each key: N− / N+ / N (register size), REDO, ○CTRL, CAT (catalog, custom gates, DEFINE), iSWAP, RST, √Y, MX, MY, IF, √X†, S†, T†, RXX, RYY, RZZ, sin / cos / exp, parentheses, U, +, √, RCL, t, VAR, STO.
- Symbols: `t` and the VAR letters (θ φ λ α β γ δ τ ω) in angles; the symbol badge opens sliders and t playback. STO / RCL with a digit 1–9 store whole tapes.
- Classical control: measuring qubit q writes bit c[q]; IF (2ND Z) with `k` or `k,v` makes the next gate conditional on c[k] = v.
- Views: KET, PROB, BLOCH, SHOTS, TAPE (scrubber, ≡ menu: examples, OpenQASM import/export, Qiskit Python export, share links), LAB.
- Up to 20 qubits the register is a statevector; above 20 (to 1024) a stabilizer tableau that takes Clifford gates only.
- Noise: LAB → Noise & error → Noise model (Qiskit Aer conventions; presets and device calibration files).
- Conventions: q0 is the leftmost, most significant bit of |q0 q1 …⟩; Qiskit prints it rightmost. RX(θ) = e^(−iθX/2), as in Qiskit.
