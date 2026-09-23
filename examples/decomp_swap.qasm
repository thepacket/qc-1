// SWAP from three CX (2 qubits): CX(0→1) CX(1→0) CX(0→1) exchanges the
// qubits (the XOR-swap trick: a ⊕= b, b ⊕= a, a ⊕= b).
//
// Check: prepare a test state, apply SWAP, then the three CX (SWAP is its
// own inverse, so the pair cancels), then undo the test state. Ending in
// |00⟩ proves the two are equal.

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
swap q[0], q[1];

// Its decomposition: three alternating CX.
cx q[0], q[1];
cx q[1], q[0];
cx q[0], q[1];

// Undo the test state: KET shows |00⟩ with probability 1 exactly when the
// decomposition equals the gate (global phase aside).
ry(-0.5) q[1];
cx q[0], q[1];
rz(0.4) q[1];
ry(-2.1) q[1];
rz(-1.3) q[0];
ry(-0.7) q[0];
