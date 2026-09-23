# QC-1 — Quantum Calculator One

A pocket quantum calculator for your phone. Key in gates and watch the state
change at once, like a pocket calculator for qubits. It's a web app you can
install to your home screen, and it works offline.

**Live:** https://qc1.fly.dev

## What it does

- Up to 20 qubits, simulated in your browser (a Web Worker). Nothing is
  computed on a server.
- A calculator keypad: H, X, Y, Z, S, T, √X, rotations with typed angles
  (`3π÷4`), P, U, SWAP, iSWAP, RXX/RYY/RZZ, measurements and reset.
  Controls and anti-controls come from CTRL marks, and 2ND gives second
  functions.
- **CATALOG** (2ND+ALL) for the rest: hardware-native gates (ECR, fSim, MS,
  GPi…), relative-phase Toffolis and state preparation.
- A color display with KET, PROB, BLOCH, SHOTS and TAPE views. Expand it to
  fill the screen.
- **OpenQASM 3 export**, checked against Qiskit (exact statevectors,
  global phase included).

## Correctness

The simulator and every analysis are checked against Qiskit and numpy
references. See [`validation/README.md`](validation/README.md). Bugs found in
the upstream code this was ported from are listed in
[`docs/quantiom-bugs.md`](docs/quantiom-bugs.md).

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
stack in `validation/`.

QC-1 reuses code from an MIT-licensed project by the same author.

## License

MIT, © 2026 Andre Paquette
