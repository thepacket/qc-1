// Quantum Fourier addition — Draper's algorithm extended to 2-bit
// inputs (4 qubits total: a[0..1] and b[0..1]).
//
// Idea: compute |a⟩|b⟩ → |a⟩|a + b mod 4⟩ by going through the QFT
// basis. In the QFT basis, addition becomes a sum of LOCAL phase
// rotations — much cheaper than the ripple-carry adder (no
// CCX/Toffoli, no carry qubits).
//
// Steps:
//   1. QFT on b register: b ↦ |QFT(b)⟩.
//   2. For each bit a_j of the addend, apply controlled phase rotations
//      Rz(π/2^k) onto b — the QFT-basis "add a" operation.
//   3. Inverse QFT on b register: |QFT(a+b)⟩ ↦ |a+b⟩.
//
// Below: a = 01 (q[1] q[0]) is the classical addend, b = 10 (q[3] q[2])
// the quantum register; each register's lower qubit is its least
// significant bit (Qiskit's order). Expected output on b: 10 + 01 = 11 (binary 3).

OPENQASM 3.0;
include "stdgates.inc";

qubit[4] q;       // q[0..1] = a, q[2..3] = b (lower qubit = least significant bit)
bit[2] c;

// Classical addend a = 01.
x q[0];

// Quantum input b = 10.
x q[3];

// QFT on b register.
h q[3];
cp(pi/2) q[2], q[3];
h q[2];
swap q[3], q[2];

// Controlled phase additions: a + b in the Fourier basis.
// QC-1 fix: in the QFT basis b's qubit j carries e^{2πi·b·2^j/4}, so adding
// a multiplies it by e^{2πi·a·2^j/4}: a phase π·2^(m+j−1) from a's bit m onto
// b's bit j (the 2π term, m = j = 1, is the identity). Upstream's angles left
// b = 11 with probability 0.43 only.
cp(pi/2) q[0], q[2];
cp(pi)   q[0], q[3];
cp(pi)   q[1], q[2];

// Inverse QFT on b register.
swap q[3], q[2];
h q[2];
cp(-pi/2) q[2], q[3];
h q[3];

c[0] = measure q[2];
c[1] = measure q[3];
