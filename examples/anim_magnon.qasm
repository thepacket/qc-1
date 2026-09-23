// A spin wave on a chain (5 qubits). One flipped spin (a magnon) starts
// at q[0]; four brickwork layers of XX+YY couplings let it hop along the
// chain. Each coupling is RXX(t)·RYY(t) = exp(−i t (XX+YY)/2), which on
// one excitation is a partial swap: amplitude cos t to stay, −i sin t to
// hop.
//
// At t = π/2 every coupling is a full swap and the magnon marches one
// site per layer, reaching q[4] intact. At t = π nothing hops. In between
// it spreads out as a wave, with interference between the paths.
// Watch PROB: exactly one qubit is 1 at all times (the XY chain conserves
// the number of flipped spins), but which one is a superposition.
//
// Play: tap the t badge in the status bar, then ▶.

OPENQASM 3.0;
include "stdgates.inc";

input float t;

qubit[5] q;

// One flipped spin at the left end.
x q[0];

// Layer 1: couple q[0]–q[1] and q[2]–q[3].
rxx(t) q[0], q[1];
ryy(t) q[0], q[1];
rxx(t) q[2], q[3];
ryy(t) q[2], q[3];

// Layer 2: couple q[1]–q[2] and q[3]–q[4].
rxx(t) q[1], q[2];
ryy(t) q[1], q[2];
rxx(t) q[3], q[4];
ryy(t) q[3], q[4];

// Layer 3: the even bonds again.
rxx(t) q[0], q[1];
ryy(t) q[0], q[1];
rxx(t) q[2], q[3];
ryy(t) q[2], q[3];

// Layer 4: the odd bonds again.
rxx(t) q[1], q[2];
ryy(t) q[1], q[2];
rxx(t) q[3], q[4];
ryy(t) q[3], q[4];
