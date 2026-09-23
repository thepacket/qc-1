// Mirror circuit (3 qubits): a benchmark that needs no simulation to
// score. Three layers of rotations and CX, then the same layers inverted
// in reverse order, so the ideal circuit is the identity and ends in |000⟩.
//
// On real hardware (or with LAB → Noise & error → Noise model on) the
// errors don't cancel, and P(000) falls below 1: the drop measures the
// circuit's error rate. Step through to watch the state spread out and
// fold back.

OPENQASM 3.0;
include "stdgates.inc";

qubit[3] q;

// Layer 1.
ry(0.9) q[0];
rx(1.7) q[1];
ry(-0.6) q[2];
cx q[0], q[1];

// Layer 2.
rz(1.1) q[1];
ry(2.3) q[2];
cx q[1], q[2];

// Layer 3.
rx(-1.4) q[0];
ry(0.8) q[1];
cx q[2], q[0];

// The mirror: layer 3 undone.
cx q[2], q[0];
ry(-0.8) q[1];
rx(1.4) q[0];

// Layer 2 undone.
cx q[1], q[2];
ry(-2.3) q[2];
rz(-1.1) q[1];

// Layer 1 undone: back to |000⟩.
cx q[0], q[1];
ry(0.6) q[2];
rx(-1.7) q[1];
ry(-0.9) q[0];
