// Teleporting a moving state (3 qubits). q[0] holds a state that moves
// with t (polar angle t, azimuth 2t); a Bell pair on q[1], q[2] and two
// measured bits carry it to q[2], with the corrections applied under IF.
//
// Every measurement outcome has probability 1/4 whatever t is, so the
// recorded outcomes stay valid as t plays, and in BLOCH q[2]'s vector
// follows the curve q[0] started with, while q[0] and q[1] sit at the
// poles they were measured into.
// Play: tap the t badge in the status bar, then ▶.

OPENQASM 3.0;
include "stdgates.inc";

input float t;

qubit[3] q;
bit[3] c;

// The state to send.
ry(t) q[0];
rz(2*t) q[0];

// A Bell pair shared between q[1] (here) and q[2] (there).
h q[1];
cx q[1], q[2];

// Bell measurement of q[0] and q[1].
cx q[0], q[1];
h q[0];
c[0] = measure q[0];
c[1] = measure q[1];

// Corrections on q[2]: X if c[1] is 1, then Z if c[0] is 1.
if (c[1] == 1) x q[2];
if (c[0] == 1) z q[2];
