// Phase estimation, swept (4 qubits). The target q[3] is an eigenstate
// |1⟩ of P(t) with eigenvalue e^{it}. Three counting qubits read the
// phase t/2π to three bits: after the inverse QFT, q[0..2] hold the
// binary fraction, q[0] the most significant bit.
//
// When t is a multiple of 2π/8 the answer is exact (PROB shows one bar:
// 000, 001, … 111 in turn). In between, the probability spreads over the
// neighbouring values, the resolution limit of three bits.
// Play: tap the t badge in the status bar, then ▶ (PROB view).

OPENQASM 3.0;
include "stdgates.inc";

input float t;

qubit[4] q;

// The eigenstate |1⟩ and a uniform superposition of the counting register.
x q[3];
h q[0];
h q[1];
h q[2];

// Phase kickback: counting qubit k applies P(t)^(2^k) (q[2] is bit 0).
cp(t) q[2], q[3];
cp(2*t) q[1], q[3];
cp(4*t) q[0], q[3];

// Inverse QFT on q[0..2] (q[0] most significant): swap, then Hadamards and controlled phases.
swap q[0], q[2];
h q[2];
cp(-pi/2) q[2], q[1];
h q[1];
cp(-pi/4) q[2], q[0];
cp(-pi/2) q[1], q[0];
h q[0];
