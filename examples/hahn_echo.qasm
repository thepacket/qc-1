// Hahn echo (2 qubits). A qubit on the equator slowly turns about Z when
// its frequency is off by θ per time step (a detuning). Ramsey on q[0]:
// H, four idle steps, H, so P(0) = cos²(2θ) drifts with θ. Echo on q[1]:
// the same, with an X halfway. The X reverses the turning, so the second
// half undoes the first and q[1] ends at |0⟩ whatever θ is.
//
// Drag θ (tap the θ badge): q[0] swings, q[1] stays put. The echo cancels
// any constant detuning. With LAB → Noise & error → Noise model on, the
// idle steps also decohere: random (Markovian) dephasing, which no echo
// can undo, makes both fade.

OPENQASM 3.0;
include "stdgates.inc";

input float theta;

qubit[2] q;

// Onto the equator.
h q[0];
h q[1];

// First half: two idle steps with the detuning θ each.
rz(theta) q[0];
rz(theta) q[1];
rz(theta) q[0];
rz(theta) q[1];

// The echo pulse (q[1] only).
x q[1];

// Second half: two more idle steps.
rz(theta) q[0];
rz(theta) q[1];
rz(theta) q[0];
rz(theta) q[1];

// Back off the equator and read out: q[0] shows the drift, q[1] none.
h q[0];
h q[1];
