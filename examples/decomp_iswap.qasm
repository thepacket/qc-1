// iSWAP from CX (2 qubits). iSWAP swaps |01⟩ and |10⟩ with a factor i:
// iSWAP = (S⊗S) · (H⊗I) · CX(0→1) · CX(1→0) · (I⊗H), two CX in all.
//
// Check: prepare a test state, apply iSWAP, then the inverse of the
// decomposition (the same gates reversed, S → S†), then undo the test
// state. Ending in |00⟩ proves the decomposition equals iSWAP.

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
iswap q[0], q[1];

// The inverse of its decomposition: H, CX(1→0), CX(0→1), H, S†, S†.
h q[1];
cx q[1], q[0];
cx q[0], q[1];
h q[0];
sdg q[1];
sdg q[0];

// Undo the test state: KET shows |00⟩ with probability 1 exactly when the
// decomposition equals the gate (global phase aside).
ry(-0.5) q[1];
cx q[0], q[1];
rz(0.4) q[1];
ry(-2.1) q[1];
rz(-1.3) q[0];
ry(-0.7) q[0];
