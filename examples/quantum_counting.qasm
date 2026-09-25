// Quantum counting (5 qubits): how many of N = 4 items are marked,
// without finding them. Phase estimation of the Grover operator G reads
// its rotation angle 2θ, where sin²θ = M/N, M the number of marked items.
//
// Here the oracle marks M = 2 items (01 and 10: the phase flip Z⊗Z), so
// θ = π/4 and G turns by π/2 per step: its eigenphases are ±1/4 of a turn.
// Three clock qubits q[0..2] (q[0] least significant, as in Qiskit) read
// 010 or 110 as q[2] q[1] q[0] (2/8 or 6/8), each with probability 1/2, and
// both give M = N sin²(π·2/8) = 2.

OPENQASM 3.0;
include "stdgates.inc";

// One Grover step on two qubits: the oracle Z⊗Z, then the diffusion (up to a sign).
gate grover a, b {
  z a;
  z b;
  h a;
  h b;
  x a;
  x b;
  cz a, b;
  x a;
  x b;
  h a;
  h b;
}

qubit[5] q;

// Search register in the uniform superposition; clock in superposition.
h q[3];
h q[4];
h q[2];
h q[1];
h q[0];

// Controlled powers of G: clock bit k (q[0] is bit 0) applies G^(2^k).
// G once, controlled by q[2].
ctrl @ grover q[0], q[3], q[4];
// G twice, controlled by q[1].
ctrl @ grover q[1], q[3], q[4];
ctrl @ grover q[1], q[3], q[4];
// G four times, controlled by q[0].
ctrl @ grover q[2], q[3], q[4];
ctrl @ grover q[2], q[3], q[4];
ctrl @ grover q[2], q[3], q[4];
ctrl @ grover q[2], q[3], q[4];

// Inverse QFT on the clock (q[0] least significant, as Qiskit's QFT).
swap q[2], q[0];
h q[0];
cp(-pi/2) q[0], q[1];
h q[1];
cp(-pi/4) q[0], q[2];
cp(-pi/2) q[1], q[2];
h q[2];
