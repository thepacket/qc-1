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
  trajectories, asymmetric readout errors, ZNE and PEC, device calibration
  import.
- **Measure it like hardware**: SHOTS → repeat runs the circuit again and
  again, and every tab then shows only what measurements would give, with
  shot noise, tomography and error bars (see below).
- **AI chat** through OpenRouter with your own key: it reads the circuit, runs LAB
  analyses and proposes circuits you apply with a tap.
- **Import and export**: OpenQASM 2/3 import, 120 example programs (each can be
  stepped through with its comments), OpenQASM 3 and Qiskit (Python) export,
  share links and QR codes.

## Measure it like hardware (SHOTS → repeat)

By default QC-1 shows the exact state. Switch on **repeat** in the SHOTS tab
(with a rate, in runs per second) and it behaves like a quantum computer
instead: the circuit is run again and again, whichever tab is open, and every
tab shows only what that run's measurements give. The numbers fluctuate from
run to run and settle as the number of shots N grows.

Each run is a set of experiments of N shots each:

| Experiment | What it feeds |
|---|---|
| **Z** (the SHOTS sample) | SHOTS; PROB (frequencies ± standard error); the LAB panels that only read Z-basis probabilities (entropies of the distribution, ZZ correlations, symmetry sectors…) |
| **X and Y** (every qubit measured in X, in Y) | BLOCH's x and y (z from Z), each ± its error |
| **State tomography** (all 3ⁿ Pauli settings, linear inversion, the nearest physical ρ by Smolin–Gambetta–Smith, as Qiskit Experiments' `StateTomography`) | STATE (the reconstructed state, with the weight λ₁ of ρ̂'s leading eigenvector, below 1 under noise) and the LAB panels that read the state |
| **Local tomography** (3ᵏ settings on just the k qubits a panel needs) | density matrices, mutual information, negativity, concurrence, discord, tripartite information and phase disks, from the measured mixed ρ of those qubits |

LAB numbers carry **± error bars** from a bootstrap: the run's counts are
resampled and the panel re-run. Panels that don't read the state (circuit
structure and tools, the noise model, benchmarks) are experiments of their own
and don't change.

**With noise on**, every experiment samples the noisy circuit:
- gate noise, damping and crosstalk as in the noise model;
- the basis changes before measuring (H, S†) carry their own gate noise;
- readout errors can be **asymmetric**: a 1 misread as 0 more often than a 0 as
  1, set in the noise model or read from an IBM device file (`prob_meas1_prep0`,
  `prob_meas0_prep1`);
- **mitigate readout** (in the SHOTS bar) undoes the readout confusion matrix
  on every count, as readout-error mitigation does on a device.

**What can be measured at which size:**

| | up to 6 qubits | 7 – 20 qubits | 21 – 1024 qubits (stabilizer mode) |
|---|---|---|---|
| SHOTS, PROB, BLOCH | ✓ | ✓ | ✓ (PROB as each qubit's P(1); no noise model in this mode) |
| STATE | reconstructed by tomography | √frequency only: phases need tomography | stabilizer generators, exact (without noise, measuring one always gives ±1) |
| Local LAB panels | from the full tomography | local tomography: ideal at any size; with noise from the model's density matrix up to 10 qubits (8 if the circuit measures), then from noise trajectories within a work budget | not available (these panels stop at 20 qubits) |
| Full-state LAB panels (Rényi, Wigner, magic, QFI…) | on the reconstructed state | "not measurable at this size" (3ⁿ settings) | not available |

**Still idealized:** the device never drifts (no calibration changes between
runs, no leakage or non-Markovian effects); readout errors are independent per
qubit; crosstalk to qubits outside a locally measured group is left out; panels
that need the full state see ρ̂'s leading eigenvector, the closest pure state;
and experiments cost no time (a 6-qubit tomography is 729 settings × N shots
per run).

## Correctness

Every simulation path and analysis is checked against Qiskit, Qiskit Aer,
numpy or scipy references. Examples:
- exact statevectors and unitaries, global phase included;
- density matrices built from Aer's error channels;
- the 120 examples read by Qiskit (the three above 20 qubits as
  stabilizer states);
- the generated Qiskit scripts executed;
- stabilizer states up to 200 qubits;
- every block against the Qiskit object it is named after;
- the tomography estimator (linear inversion, projection onto a physical ρ,
  per-setting probabilities) against numpy and Qiskit's `DensityMatrix`;
- asymmetric readout against Aer's `ReadoutError`.

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
