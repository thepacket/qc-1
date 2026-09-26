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
  grid, move them, drag control dots, and select a gate to edit its parameters,
  targets, controls and conditions. Long-press opens the Edit and Transform menus. Every OpenQASM 3
  standard gate is in the palette, plus state preparation, typed states and
  matrices, and your own gates. A classical register of its own, one lane per
  bit, for measurements and gates that run only if a bit is set.
- **A block library checked against Qiskit**: Bell pair, GHZ, uniform
  superposition, graph states, QFT, marked-state oracles, Grover, Real
  Amplitudes, Efficient SU(2), QAOA, Pauli evolution, phase estimation, Pauli
  measurement, arithmetic and more. Each block is named after a Qiskit
  circuit-library object and equals it exactly; expand it into its gates or
  invert it. Inspect a selected block inline without changing the circuit.
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
- **Measure it like hardware**: Simulated Measurements mode provides single runs
  and optional auto-repeat, showing simulated measurement results with
  shot noise, tomography and error bars (see below).
- **AI chat** through OpenRouter with your own key: it reads the circuit, runs LAB
  analyses and proposes circuits you apply with a tap.
- **Import and export**: OpenQASM 2/3 import, 120 example programs (each can be
  stepped through with its comments), OpenQASM 3 and Qiskit (Python) export,
  share links and QR codes.

## Mixed states and ordering

With noise enabled, **STATE** starts with the density matrix and its purity.
The optional leading eigenvector is labeled as one component; degenerate
components are explicitly non-unique. Direct noisy STATE supports up to 8
qubits, full tomography up to 6, and eigenvectors up to 6. Larger matrices show
a labeled 8 × 8 preview; purity uses the entire matrix. Blue diagonal cells
show probabilities; orange off-diagonal cells show coherence, with a color key.

In Direct Calculation, supported LAB analyses use the noisy ensemble: reduced density,
mutual information, negativity, concurrence, discord, tripartite information,
phase disks, expectation and variance, coherence, total correlation, and
probability-only quantities (up to 8 qubits). Mixed-state **Quantum Fisher
information** uses the spectral formula for collective rotations, up to 6
qubits; it does not equate QFI with four times the variance of a mixture.

Local-density panels extend beyond 8 circuit qubits, up to each panel's own
limit (at most 20 circuit qubits and 6 kept qubits). They average only the
requested reduced matrices over noise trajectories. A work budget can reduce
the trajectory count or refuse an oversized calculation; results report the
actual count and approximation. Trajectory uncertainty is not included in
error bars. Full noisy STATE retains its 8-qubit limit.

Simulated Measurements uses sampled
counts or tomography. Pure-state-only panels report their limitation under noise.
Readout errors affect measurements, not the pre-readout density matrix.
Reduced density plots label the actual kept-qubit order, including nonadjacent
subsets, alongside the existing bitstring, Pauli, and typed-input mappings.

## Learn and explore

Open **Help (?) → Learn by predicting** for six guided experiments:
superposition, relative phase, interference, entanglement, measurement, and
noise. Choose a prediction, run 512 simulated shots, and compare the counts
with calculated probabilities. Practice circuits are isolated from your work.

LAB opens directly to its groups and search. Favourites and Recent provide
quick access to analyses.

**LAB → Noise & error → Ideal vs noisy** compares probabilities,
purity, and a Pauli observable in adjacent columns, with their differences.
Enable the noise model first. Readout errors can be included in the probability
comparison; purity and observables remain pre-readout state quantities.
The panel supports up to 8 qubits and identifies trajectory approximations.

## Measure it like hardware

The mode toggles appear only at the top of **SHOTS**: **Direct Calculation**
(the default) and **Simulated Measurements**. The active mode has a cyan
background. These settings also determine how STATE, PROB, BLOCH and supported
LAB panels obtain their results. Neither mode connects to physical hardware.

Noise is independent of the mode: enable it in **LAB → Noise & error → Noise
model**. **Auto-repeat** and **rate** work in either mode, with or without noise.
Starting or stopping repetition does not change the selected mode. Mode,
repeat and rate settings are saved with the session. Exact results stay the
same between repeats; SHOTS draws fresh samples.

Use **Sample shots** in Direct Calculation or **Run once** in Simulated
Measurements for a fresh sample. The mode toggles, noise indicator, shot count,
auto-repeat and rate controls are shown in SHOTS; other result panels retain
labels describing their calculation method.

See [Calculation modes and noise](docs/help/modes.md) for the comparison table,
also available near the top of the in-app Help. Bitstrings display their qubit
order: q0 is the rightmost bit.

In **Simulated Measurements**, each run is a set of experiments of N shots each:

| Experiment | What it feeds |
|---|---|
| **Z** (the SHOTS sample) | SHOTS; PROB (frequencies ± standard error); the LAB panels that only read Z-basis probabilities (entropies of the distribution, ZZ correlations, symmetry sectors…) |
| **X and Y** (every qubit measured in X, in Y) | BLOCH's x and y (z from Z), each ± its error |
| **State tomography** (all 3ⁿ Pauli settings, linear inversion, the nearest physical ρ by Smolin–Gambetta–Smith, as Qiskit Experiments' `StateTomography`) | STATE under noise (density matrix and purity, with optional leading component); mixed-state LAB panels use the reconstructed density matrix |
| **Local tomography** (3ᵏ settings on just the k qubits a panel needs) | density matrices, mutual information, negativity, concurrence, discord, tripartite information and phase disks, from the measured mixed ρ of those qubits |

LAB numbers carry **± error bars** from a bootstrap: the run's counts are
resampled and the panel re-run. Panels that don't read the state (circuit
structure and tools, the noise model, benchmarks) are experiments of their own
and don't change.

Measurements, resets and classical conditions are executed afresh for each
ideal-circuit shot; the editor's recorded branch is left intact. This also
applies to the X/Y experiments and tomography, and to stabilizer-mode sampling.
Analyses that only support pure states report that limitation when the circuit
has noise or nonunitary instructions; they do not substitute a pure component
for a mixed-state observable. Ideal STATE, amplitude and Q-sphere views explicitly
show the leading component instead of the entire mixed state.

**With noise on**, every experiment samples the noisy circuit:
- gate noise, damping and crosstalk as in the noise model;
- the basis changes before measuring (H, S†) carry their own gate noise;
- readout errors can be **asymmetric**: a 1 misread as 0 more often than a 0 as
  1, set in the noise model or read from an IBM device file (`prob_meas1_prep0`,
  `prob_meas0_prep1`);
- **mitigate readout** (in the SHOTS bar) undoes the readout confusion matrix
  on every count, as readout-error mitigation does on a device.

Readout mitigation also amplifies statistical uncertainty. BLOCH propagates
that amplification through each marginal's inverse readout correction. PROB
propagates multinomial covariance through the inverse correction, clipping
and normalization (a local linear approximation, less reliable at clipping
boundaries). LAB retains its bootstrap through the complete estimator.

**What can be measured at which size:**

| | up to 6 qubits | 7 – 20 qubits | 21 – 1024 qubits (stabilizer mode) |
|---|---|---|---|
| SHOTS, PROB, BLOCH | ✓ | ✓ | ✓ (PROB as each qubit's P(1); no noise model in this mode) |
| STATE | reconstructed by tomography | √frequency only: phases need tomography | stabilizer generators, exact (without noise, measuring one always gives ±1) |
| Local LAB panels | from the full tomography | local tomography: ideal at any size; with noise from the model's density matrix up to 10 qubits (8 if the circuit measures), then from noise trajectories within a work budget | not available (these panels stop at 20 qubits) |
| Full-state LAB panels (Rényi, Wigner, magic, QFI…) | on the reconstructed state for ideal unitary circuits; pure-state-only analyses unavailable for noisy/nonunitary circuits | "not measurable at this size" (3ⁿ settings) | not available |

**Still idealized:** the device never drifts (no calibration changes between
runs, no leakage or non-Markovian effects); readout errors are independent per
qubit; crosstalk to qubits outside a locally measured group is left out; pure-state
visualizations show ρ̂'s leading eigenvector, the closest pure state;
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
There are **502 in-app reference checks**, separate from the **1,586 automated
development tests**.
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
