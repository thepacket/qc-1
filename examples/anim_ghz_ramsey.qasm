// GHZ sensing versus a single qubit (5 qubits). A field of strength t
// turns every qubit by RZ(t). q[4] alone is a Ramsey interferometer: its
// fringe is P(0) = cos²(t/2). q[0..3] share the field in a GHZ state,
// which picks up 4× the phase: its fringe is P(0000) = cos²(2t), four
// times as fast. That speed-up (N× for N qubits) is the Heisenberg limit
// of quantum sensing.
//
// Watch PROB: the q[0..3] fringe runs four cycles while q[4] runs one.
// Play: tap the t badge in the status bar, then ▶.

OPENQASM 3.0;
include "stdgates.inc";

input float t;

qubit[5] q;

// Prepare the GHZ state (|0000⟩ + |1111⟩)/√2 on q[0..3].
h q[0];
cx q[0], q[1];
cx q[1], q[2];
cx q[2], q[3];

// The field: each qubit turns by t; |1111⟩ gains a phase 4t relative to |0000⟩.
rz(t) q[0];
rz(t) q[1];
rz(t) q[2];
rz(t) q[3];

// Undo the GHZ preparation: the phase 4t lands on q[0] alone.
cx q[2], q[3];
cx q[1], q[2];
cx q[0], q[1];
h q[0];

// The single-qubit reference: H, the same field, H. P(0) = cos²(t/2).
h q[4];
rz(t) q[4];
h q[4];
