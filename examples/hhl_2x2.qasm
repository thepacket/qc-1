// HHL: solving a linear system A x = b (4 qubits), at its smallest.
//
//   A = [[3/2, −1/2], [−1/2, 3/2]] (eigenvalues 1 on |+⟩, 2 on |−⟩),
//   b = |0⟩, so x ∝ A⁻¹ b ∝ (3, 1).
//
// q[3] holds b, the clock q[1] q[2] (q[1] least significant, as in Qiskit)
// runs phase estimation of e^{iAπ/2}, which writes each eigenvalue λ into
// the clock (λ = 1 as 01, λ = 2 as 10, read q[2] q[1]). The ancilla q[0] is then rotated by
// arcsin(1/λ), putting the factor 1/λ into its |1⟩ branch, and the clock
// is uncomputed. In KET (q[3] q[2] q[1] q[0], q[0] rightmost) the two terms
// with q[0] = 1 are |0001⟩ and |1001⟩,
// with amplitudes in the ratio 3 : 1: that branch holds x. (Measuring
// q[0] = 1, probability 5/8 here, would leave q[3] exactly in x.)

OPENQASM 3.0;
include "stdgates.inc";

qubit[4] q;

// Clock in uniform superposition (b = |0⟩ needs no preparation).
h q[2];
h q[1];

// Phase estimation. U = e^{iAπ/2} = e^{i3π/4} RX(π/2), controlled by the clock's low bit…
crx(pi/2) q[1], q[3];
p(3*pi/4) q[1];
// …and U² = e^{i3π/2} RX(π), controlled by its high bit.
crx(pi) q[2], q[3];
p(3*pi/2) q[2];

// Inverse QFT on the clock: now it reads λ (01 or 10).
swap q[2], q[1];
h q[1];
cp(-pi/2) q[1], q[2];
h q[2];

// The 1/λ rotation: sin(θ/2) = 1/λ, so RY(π) for λ = 1 and RY(π/3) for λ = 2.
cry(pi) q[1], q[0];
cry(pi/3) q[2], q[0];

// Uncompute: QFT, the inverse controlled powers, Hadamards.
h q[2];
cp(pi/2) q[1], q[2];
h q[1];
swap q[2], q[1];
p(-3*pi/2) q[2];
crx(-pi) q[2], q[3];
p(-3*pi/4) q[1];
crx(-pi/2) q[1], q[3];
h q[2];
h q[1];
