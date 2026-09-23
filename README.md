# QC-1 — Quantum Calculator One

A pocket quantum calculator for your phone. Key in gates and watch the state
change at once, like a pocket calculator for qubits. It's a web app you can
install to your home screen, and it works offline.

**Live:** https://qc1.fly.dev

## What it does

- **Up to 20 qubits** on a statevector, simulated in your browser (Web
  Workers). Above 20 and up to **1024 qubits**, Clifford circuits run on a
  stabilizer tableau. Nothing is computed on a server.
- **A calculator keypad**: H, X, Y, Z, S, T, √X, rotations with typed angles
  (`3π÷4`), P, U, SWAP, iSWAP, RXX/RYY/RZZ, measurements and reset.
  Controls and anti-controls come from CTRL marks, and 2ND gives second
  functions. **CATALOG** has the rest: ECR, fSim, MS, GPi…, relative-phase
  Toffolis, state preparation, and your own gates (**DEFINE**).
- **Symbols and the t clock** in angles, with sliders and playback;
  **STO/RCL** memories; **IF** for classical control after mid-circuit
  measurements.
- **Views**: KET, PROB, BLOCH, SHOTS, TAPE (with a step scrubber) and **LAB**:
  116 analyses and tools in 13 categories. They cover state, measurement,
  phase space and magic, metrology, entanglement, dynamics, operators and
  spectra, circuit structure, and circuit tools (simplify, transpile, route,
  compile, inverse, Trotter, state prep, synthesis). They also cover noise,
  benchmarking (RB, QV, XEB, T1/T2, tomography…) and verification.
- **Noise** with Qiskit Aer's conventions: exact density matrices or
  trajectories, ZNE and PEC, device calibration import.
- **Import and export**: OpenQASM 2/3 import, 93 example programs, OpenQASM 3
  and Qiskit (Python) export, share links.

## Correctness

Every simulation path and analysis is checked against Qiskit, Qiskit Aer,
numpy or scipy references. Examples:
- exact statevectors and unitaries, global phase included;
- density matrices built from Aer's error channels;
- the 93 examples read by Qiskit;
- the generated Qiskit scripts executed;
- stabilizer states up to 200 qubits.

See [`validation/README.md`](validation/README.md). In the app, LAB →
Verification & export → **Self-test** replays the references on your device.
Bugs found in the upstream code this was ported from (24 so far) are listed in
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
