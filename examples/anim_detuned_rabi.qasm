// Detuned Rabi oscillations (3 qubits). A drive rotates a qubit by t
// about an axis in the x–z plane; the further the axis tilts from x
// toward z (a detuned drive), the less the qubit can flip.
//
//   q[0]: axis x (on resonance): full flops, P(1) reaches 1.
//   q[1]: axis tilted by π/6: P(1) reaches cos²(π/6) = 0.75.
//   q[2]: axis tilted by π/3: P(1) reaches cos²(π/3) = 0.25.
//
// In BLOCH each vector circles its own axis: a great circle for q[0],
// smaller and smaller cones for q[1] and q[2].
// Play: tap the t badge in the status bar, then ▶.

OPENQASM 3.0;
include "stdgates.inc";

input float t;

qubit[3] q;

// q[0]: rotate by t about x.
rx(t) q[0];

// q[1]: rotate by t about x tilted by π/6 (tilt, rotate about x, tilt back).
ry(-pi/6) q[1];
rx(t) q[1];
ry(pi/6) q[1];

// q[2]: the same about x tilted by π/3.
ry(-pi/3) q[2];
rx(t) q[2];
ry(pi/3) q[2];
