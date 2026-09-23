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

## Quirks in the reference tools (not upstream bugs)

- `qiskit-qasm3-import` 0.6.0 binds a custom gate's parameters in
  **alphabetical order of their names**, not declared order. QC-1 names them
  `p0, p1, …`.
- `qiskit-qasm3-import` 0.6.0 can't evaluate function calls such as
  `sqrt(2)` in parameters (valid OpenQASM 3). QC-1 folds those to numbers
  on export.
