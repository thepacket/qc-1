// Interference (2 qubits). A Hadamard makes an equal superposition; a
// second Hadamard makes the two paths interfere. Step through and watch
// PROB and KET.
//
// q[0]: H then H. After the first H, q[0] is 0 or 1 with equal odds; after
// the second it is 0 for certain: the two paths to 1 cancel.
// q[1]: H, Z, H. The Z changes only a sign, invisible in PROB (still 50/50),
// but after the second H the paths to 0 cancel instead: q[1] is 1 for
// certain. A phase matters only once paths interfere.

OPENQASM 3.0;
include "stdgates.inc";

qubit[2] q;

// First Hadamard on both: 50/50 each (PROB shows four equal bars).
h q[0];
h q[1];

// A phase flip on q[1]: PROB doesn't change, KET shows the minus signs.
z q[1];

// Second Hadamard: the paths interfere. q[0] returns to 0, q[1] ends at 1.
h q[0];
h q[1];
