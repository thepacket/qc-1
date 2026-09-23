// Quantum walk on a ring of 8 sites (4 qubits). q[0..2] hold the walker's
// position (q[0] the most significant bit), q[3] is its coin. Each step
// turns the coin by RY(t), then moves the walker one site up if the coin
// is 1 and one site down if it is 0, in superposition.
//
// The walker starts at site 4 (|100⟩) with the coin in (|0⟩ + i|1⟩)/√2.
// At t = 0 the coin never turns: the walker splits in two and runs both
// ways (sites 1 and 7 after three steps). At t = π the coin flips every
// step and the walker zig-zags around its start (sites 3 and 5). In
// between, interference shapes the spread: nothing like a classical random
// walk's bell curve.
//
// PROB lists position then coin (e.g. 111 1 = site 7, coin 1).
// Play: tap the t badge in the status bar, then ▶.

OPENQASM 3.0;
include "stdgates.inc";

input float t;

qubit[4] q;

// Start at site 4, coin in (|0⟩ + i|1⟩)/√2 (a balanced, symmetric coin).
x q[0];
h q[3];
s q[3];

// Step 1. Turn the coin.
ry(t) q[3];
// Coin 1: site + 1 (flip each bit whose lower bits are all 1, top bit first).
ctrl(3) @ x q[3], q[1], q[2], q[0];
ctrl(2) @ x q[3], q[2], q[1];
cx q[3], q[2];
// Coin 0: site − 1 (flip each bit whose lower bits are all 0).
negctrl(3) @ x q[3], q[1], q[2], q[0];
negctrl(2) @ x q[3], q[2], q[1];
negctrl @ x q[3], q[2];

// Step 2. Turn the coin, then move.
ry(t) q[3];
ctrl(3) @ x q[3], q[1], q[2], q[0];
ctrl(2) @ x q[3], q[2], q[1];
cx q[3], q[2];
negctrl(3) @ x q[3], q[1], q[2], q[0];
negctrl(2) @ x q[3], q[2], q[1];
negctrl @ x q[3], q[2];

// Step 3. Turn the coin, then move.
ry(t) q[3];
ctrl(3) @ x q[3], q[1], q[2], q[0];
ctrl(2) @ x q[3], q[2], q[1];
cx q[3], q[2];
negctrl(3) @ x q[3], q[1], q[2], q[0];
negctrl(2) @ x q[3], q[2], q[1];
negctrl @ x q[3], q[2];
