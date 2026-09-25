# QC-1 — Quantum Calculator One

A quantum circuit simulator for your phone. Drag gates from a palette onto
the circuit diagram and watch the state change at once. It's a web app you can
install to your home screen, and it works offline.

**Live:** https://qc1.fly.dev

## What it does

- **Up to 20 qubits** on a statevector, simulated in your browser (Web
  Workers). Above 20 and up to **1024 qubits**, Clifford circuits run on a
  stabilizer tableau. Nothing is computed on a server.
- **Qiskit's bit order** everywhere: q0 is the rightmost bit of kets,
  bitstrings and Pauli strings, so results read the way Qiskit prints them.
- **A circuit editor on the diagram**: drag gates from the palette into the
  grid, move them, drag control dots, long-press for a gate's angles, controls
  and conditions, or for the Edit and Transform menus. Every OpenQASM 3
  standard gate is in the palette, plus state preparation, typed states and
  matrices, and your own gates. A classical register of its own, one lane per
  bit, for measurements and gates that run only if a bit is set.
- **A block library checked against Qiskit**: Bell pair, GHZ, uniform
  superposition, graph states, QFT, marked-state oracles, Grover, Real
  Amplitudes, Efficient SU(2), QAOA, Pauli evolution, phase estimation, Pauli
  measurement, arithmetic and more. Each block is named after a Qiskit
  circuit-library object and equals it exactly; expand it into its gates or
  invert it.
- **Symbols and the t clock** in angles (θ₀, γ₁… with keys for them), with
  sliders and playback; a step-through of the circuit.
- **Views**: CIRCUIT (the diagram, the steps, the OpenQASM), STATE, PROB,
  BLOCH, SHOTS and **LAB**: 119 analyses and tools in 21 groups. They cover
  state, measurement, phase space and magic, metrology, entanglement,
  dynamics, operators and spectra, circuit structure, and circuit tools
  (simplify, transpile, route, compile, inverse, Trotter, state prep,
  synthesis). They also cover noise, benchmarking (RB, QV, XEB, T1/T2,
  tomography…), error correction (surface and repetition codes with a
  union-find decoder) and verification.
- **Noise** with Qiskit Aer's conventions: exact density matrices or
  trajectories, ZNE and PEC, device calibration import.
- **AI chat** through OpenRouter with your own key: it reads the circuit, runs LAB
  analyses and proposes circuits you apply with a tap.
- **Import and export**: OpenQASM 2/3 import, 120 example programs (each can be
  stepped through with its comments), OpenQASM 3 and Qiskit (Python) export,
  share links and QR codes.

## Correctness

Every simulation path and analysis is checked against Qiskit, Qiskit Aer,
numpy or scipy references. Examples:
- exact statevectors and unitaries, global phase included;
- density matrices built from Aer's error channels;
- the 120 examples read by Qiskit (the three above 20 qubits as
  stabilizer states);
- the generated Qiskit scripts executed;
- stabilizer states up to 200 qubits;
- every block against the Qiskit object it is named after.

See [`validation/README.md`](validation/README.md). In the app, LAB →
Verification & export → **Self-test** replays the references on your device.
Bugs found in the upstream code this was ported from (60 so far) are listed in
[`docs/quantiom-bugs.md`](docs/quantiom-bugs.md).

Help: the **?** button in the app, or [`docs/help`](docs/help/README.md).

## Development

```bash
npm install
```
```bash
npm run dev
```
```bash
npm test
```

`npm run validate` regenerates the reference fixtures; it needs the Python
stack in `validation/`. `npm run docs:help` regenerates the analyses list.

QC-1 reuses code from an MIT-licensed project by the same author.

## License

MIT, © 2026 Andre Paquette
