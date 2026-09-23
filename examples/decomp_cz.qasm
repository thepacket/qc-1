// CZ from CX and Hadamards (2 qubits). Conjugating the target of a CX by
// H turns X into Z: CZ = (I⊗H) CX (I⊗H).
//
// Check: prepare a test state, apply CZ, then the decomposition (CZ is its
// own inverse, so the pair cancels), then undo the test state. Ending in
// |00⟩ proves the two are equal. Step through to watch the state leave
// |00⟩ and come back.

OPENQASM 3.0;
include "stdgates.inc";

qubit[2] q;

// A lopsided test state, so no gate can pass by luck.
ry(0.7) q[0];
rz(1.3) q[0];
ry(2.1) q[1];
rz(-0.4) q[1];
cx q[0], q[1];
ry(0.5) q[1];

// The gate.
cz q[0], q[1];

// Its decomposition (equal to CZ, so it undoes it): H, CX, H on the target.
h q[1];
cx q[0], q[1];
h q[1];

// Undo the test state: KET shows |00⟩ with probability 1 exactly when the
// decomposition equals the gate (global phase aside).
ry(-0.5) q[1];
cx q[0], q[1];
rz(0.4) q[1];
ry(-2.1) q[1];
rz(-1.3) q[0];
ry(-0.7) q[0];
