// Quantum Zeno effect (2 qubits). Both qubits are rotated by t in six
// small steps of t/6. q[0] is left alone and ends with P(1) = sin²(t/2).
// q[1] is measured after every step: each measurement most likely finds
// it still at |0⟩ and resets the rotation, so it stays frozen. The chance
// that all six find 0 is cos¹²(t/12), 0.66 even at t = π, where q[0] has
// flipped completely.
//
// "A watched pot never boils": frequent measurement stops the evolution.
// Play t (tap the t badge, then ▶) and compare the two in PROB or BLOCH.

OPENQASM 3.0;
include "stdgates.inc";

input float t;

qubit[2] q;
bit[2] c;

// Step 1 of 6: both turn by t/6; q[1] is measured.
ry(t/6) q[0];
ry(t/6) q[1];
c[1] = measure q[1];

// Step 2.
ry(t/6) q[0];
ry(t/6) q[1];
c[1] = measure q[1];

// Step 3.
ry(t/6) q[0];
ry(t/6) q[1];
c[1] = measure q[1];

// Step 4.
ry(t/6) q[0];
ry(t/6) q[1];
c[1] = measure q[1];

// Step 5.
ry(t/6) q[0];
ry(t/6) q[1];
c[1] = measure q[1];

// Step 6.
ry(t/6) q[0];
ry(t/6) q[1];
c[1] = measure q[1];
