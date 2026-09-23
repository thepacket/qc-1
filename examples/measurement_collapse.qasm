// Measurement collapse (2 qubits). Make a Bell pair, then measure only
// q[0]. Before the measurement each qubit alone is completely random
// (BLOCH: both vectors have length 0). Measuring q[0] picks 0 or 1, and
// q[1], never touched, now gives the same answer for certain.
//
// Step through: the KET view goes from two terms to one. UNDO and redo
// the measurement (or reload) for a new random outcome.

OPENQASM 3.0;
include "stdgates.inc";

qubit[2] q;
bit[2] c;

// A Bell pair (|00⟩ + |11⟩)/√2.
h q[0];
cx q[0], q[1];

// Measure q[0] only: the pair collapses to |00⟩ or |11⟩.
c[0] = measure q[0];
