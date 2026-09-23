# Validation

QC-1 checks its simulator and analyses against **independent references**:
Qiskit (`qiskit.quantum_info`, `qiskit-aer`) and numpy/scipy. Nothing here
ships in the app or runs on the server. Python runs on a developer machine
and in GitHub CI only.

## How it works

1. `validation/cases/` holds seeded TypeScript generators for test tapes.
2. `validation/dump.test.ts` (`npm run validate:dump`) runs them through QC-1
   and writes `validation/out/<group>.cases.json`: the tape, QC-1's exported
   QASM 3, and QC-1's own results.
3. `validation/ref/g_<group>.py` (`npm run validate:ref`) computes the
   references and writes **`test/fixtures/<group>.json`**, which is committed. A
   generator refuses to write a fixture when QC-1 disagrees with the
   reference. A disagreement is a bug to fix, not a value to record.
4. `test/validated/*.test.ts` replays each fixture's tape in QC-1 and compares
   against the stored reference. `npm test` needs no Python.

`npm run validate` runs steps 2 and 3. Fixtures are deterministic; CI
regenerates them and fails on any diff.

## Setup

```bash
uv venv validation/.venv
```
```bash
uv pip install --python validation/.venv/bin/python -r validation/requirements.txt
```

## Conventions

- QC-1 is **big-endian** (qubit 0 = most significant bit). Qiskit is
  little-endian: compare with `Statevector(...).reverse_qargs()` and reverse
  Pauli labels.
- Where a quantity has competing conventions (log base, PTM normalisation,
  depolarising parameter, Wigner definition), QC-1 follows Qiskit's and says
  so in the analysis help.
- Deterministic comparisons use `1e-9`. Stochastic ones (trajectories, shots)
  state a k·σ bound with fixed seeds.
- Upstream bugs found this way go in `docs/quantiom-bugs.md`.
