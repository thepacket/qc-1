// Bit-flip code that corrects itself (6 qubits). A state set by θ is spread
// over three data qubits q[0..2], a bit flip hits q[1], two syndrome
// qubits measure the parities Z₀Z₁ and Z₁Z₂, and conditional gates (IF)
// undo the flip, leaving the data exactly as encoded.
//
// IF tests one bit at a time, so a third syndrome qubit q[5] computes
// "both parities fired" (the middle qubit flipped) with a Toffoli: the
// corrections are then X on q[0] if c[3] alone, X on q[2] if c[4] alone,
// X on q[1] if both. Move the error (scrub back in TAPE, DEL it, key X on
// another data qubit) and the syndrome and the correction follow.
// Drag θ (tap the θ badge) to encode another state.

OPENQASM 3.0;
include "stdgates.inc";

input float theta;

qubit[6] q;
bit[6] c;

// Encode cos(θ/2)|000⟩ + sin(θ/2)|111⟩ on q[0..2].
ry(theta) q[0];
cx q[0], q[1];
cx q[0], q[2];

// The error: a bit flip on q[1].
x q[1];

// Syndrome: q[3] = parity of q[0], q[1]; q[4] = parity of q[1], q[2].
cx q[0], q[3];
cx q[1], q[3];
cx q[1], q[4];
cx q[2], q[4];

// q[5] = both parities (the middle qubit flipped).
ccx q[3], q[4], q[5];

// Read the syndrome.
c[3] = measure q[3];
c[4] = measure q[4];
c[5] = measure q[5];

// Correct: first as if only one parity fired…
if (c[3] == 1) x q[0];
if (c[4] == 1) x q[2];
// …then, if both fired, take those back and flip the middle qubit instead.
if (c[5] == 1) x q[0];
if (c[5] == 1) x q[2];
if (c[5] == 1) x q[1];
