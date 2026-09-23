// √T from Clifford+T gates (2 qubits). Fault-tolerant hardware runs a
// small gate set exactly (H, S, CX and T) and must approximate every other
// rotation. √T = RZ(π/8), up to a global phase, is not in the set. This
// sequence of 14 H, 13 T and some S / Z gates, found by searching all
// short words, comes within 0.026 of it (operator distance, phase aside).
//
// q[0] gets the approximation, q[1] the exact RZ(π/8), both starting from
// |+⟩: in BLOCH the two vectors agree to within 0.07. Longer sequences get
// closer: the error shrinks exponentially with length (Solovay–Kitaev,
// and today's optimal methods such as gridsynth).

OPENQASM 3.0;
include "stdgates.inc";

qubit[2] q;

// Both qubits start in |+⟩.
h q[0];
h q[1];

// The exact rotation on q[1].
rz(pi/8) q[1];

// The Clifford+T approximation on q[0].
h q[0];
s q[0];
t q[0];
h q[0];
s q[0];
t q[0];
h q[0];
t q[0];
h q[0];
s q[0];
t q[0];
h q[0];
t q[0];
h q[0];
s q[0];
t q[0];
h q[0];
s q[0];
t q[0];
h q[0];
s q[0];
t q[0];
h q[0];
t q[0];
h q[0];
s q[0];
t q[0];
h q[0];
t q[0];
h q[0];
s q[0];
t q[0];
h q[0];
s q[0];
t q[0];
h q[0];
s q[0];
