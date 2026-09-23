# Upstream bugs found while porting

QC-1's code comes from an earlier project by the same author, whose tests only
check the code against itself. Porting validates each part against Qiskit or
an independent numpy reference first (see `validation/`). Every mismatch that
turned out to be an upstream bug is listed here, with how QC-1 handles it.
Upstream file paths are relative to that project's `client/src/`.

| # | Where | Symptom | Reference | QC-1 status |
|---|---|---|---|---|
| 1 | `sim/simulate.ts` `computeBloch` | Bloch ⟨Y⟩ has the wrong sign: S\|+⟩ = \|+i⟩ gives y = −1 (the stabilizer path gives +1) | analytic; Qiskit `DensityMatrix.expectation_value(Y)` | Fixed in `src/calc/analysis.ts` `bloch()`; tested |
| 2 | `sim/matrices.ts` `buildMatrix` | `rccx`/`rcccx` are plain Toffoli/C3X ("relative phase ignored"), not the relative-phase gates | Qiskit `RCCXGate`, `RC3XGate` | Implemented as gate-sequence macros (`MACROS` in `src/calc/steps.ts`); exact match |
| 3 | `sim/matrices.ts` `M_DCX`, `M_ECR` | Qubit roles reversed relative to Qiskit's gates of the same name (Qiskit's little-endian printed matrices copied into a big-endian codebase) | Qiskit `DCXGate`, `ECRGate` | QASM definitions follow the simulator's matrices; noted in `src/qasm/fromTape.ts` |
| 4 | `qasm/emit.ts` | Emits names outside `stdgates.inc` (sy, iswap, rzz, fsim, ms, cu3, …) with no `gate` definition, so Qiskit rejects the file; base gates carrying controls come out as e.g. `x q[0], q[1];` | `qiskit.qasm3.loads` | `src/qasm/fromTape.ts` adds exact definitions and names controlled forms; a generic `ctrl @` block in `src/qasm/emit.ts` |
| 5 | `qasm/emitQiskit.ts` | Drops `if` conditions silently; no mapping for fsim, sqrtswap and related gates; only Greek-named symbols become `Parameter`s | reading the code | Not ported: QC-1 writes its own Qiskit export (plan phase 11) |
| 6 | `sim/pageCurve.ts` `pageEntropyBits` | Page's average entropy sums from d_A+1 instead of d_B+1: wrong for every unequal cut, exceeding the maximum (1.58 bits for a 1\|2 split; true 0.735) | Haar Monte-Carlo average of random states | Fixed in `src/sim/pageCurve.ts` (`QC-1 fix` block); fixture `page` |
| 7 | `sim/anticoncentration.ts` | Porter–Thomas histogram puts dyadic probabilities (Bell, GHZ, uniform states: D·p exactly on a bin edge) in the bin *below* after a 1e-16 rounding error | numpy histogram of exact probabilities | `QC-1 fix`: bin with a 1e-9 edge tolerance; fixture `state2` |
| 8 | `sim/chsh.ts` | Maximal CHSH value only accurate to ~5e-9: closed-form cubic eigenvalues (`eig3`) lose precision for near-degenerate singular values (e.g. product states, exactly 2) | numpy SVD of the Pauli correlation matrix | `QC-1 fix`: Jacobi eigenvalues; fixture `state2` |
| 9 | `sim/quantumDiscord.ts` | Discord over-estimated by up to 0.011 bits: the conditional entropy is minimised only on a 10×12 grid of measurement axes | scipy multi-start Nelder–Mead (true optimum) | `QC-1 fix`: grid + Nelder–Mead refinement; now within 4e-14; fixture `state2` |

## Quirks in the reference tools (not upstream bugs)

- `qiskit-qasm3-import` 0.6.0 binds a custom gate's parameters in
  **alphabetical order of their names**, not declared order. QC-1 names them
  `p0, p1, …`.
- `qiskit-qasm3-import` 0.6.0 can't evaluate function calls such as
  `sqrt(2)` in parameters (valid OpenQASM 3). QC-1 folds those to numbers
  on export.
