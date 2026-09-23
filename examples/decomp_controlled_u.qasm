// Controlled-U from two CX (2 qubits), the "ABC" construction. Any
// one-qubit U(θ, φ, λ) = e^{iα} A X B X C with A B C = I and α = (φ+λ)/2:
//   C = RZ((λ−φ)/2),  B = RY(−θ/2) RZ(−(φ+λ)/2),  A = RZ(φ) RY(θ/2).
// Controlled on q[0]: C, CX, B, CX, A on q[1], and the phase α on q[0].
// If q[0] is 0 the CXs do nothing and A B C = I; if it is 1 the target
// gets A X B X C = e^{−iα} U, and P(α) restores the phase.
//
// Check: apply the construction, then the inverse of controlled-U, then
// undo the test state: |00⟩ proves them equal. Drag θ (the θ badge):
// it works for every angle.

OPENQASM 3.0;
include "stdgates.inc";

input float theta;

qubit[2] q;

// A lopsided test state, so no gate can pass by luck.
ry(0.7) q[0];
rz(1.3) q[0];
ry(2.1) q[1];
rz(-0.4) q[1];
cx q[0], q[1];
ry(0.5) q[1];

// The construction for U(θ, 0.4, −0.7): C, CX, B, CX, A, then the phase.
rz(-0.55) q[1];
cx q[0], q[1];
rz(0.15) q[1];
ry(-theta/2) q[1];
cx q[0], q[1];
ry(theta/2) q[1];
rz(0.4) q[1];
p(-0.15) q[0];

// The inverse of the real thing.
inv @ ctrl @ U(theta, 0.4, -0.7) q[0], q[1];

// Undo the test state: KET shows |00⟩ with probability 1 exactly when the
// decomposition equals the gate (global phase aside).
ry(-0.5) q[1];
cx q[0], q[1];
rz(0.4) q[1];
ry(-2.1) q[1];
rz(-1.3) q[0];
ry(-0.7) q[0];
