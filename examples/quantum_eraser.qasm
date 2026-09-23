// Quantum eraser (4 qubits): a Mach–Zehnder interferometer (phase θ)
// whose path is marked on a second qubit, twice.
//
// q[0], q[1]: the path is copied onto the marker q[1]. The paths are now
// distinguishable, so there is no interference: P(q[0] = 0) is 1/2 for
// every θ.
// q[2], q[3]: the same, but then the marker q[3] is measured in the X
// basis, which erases the which-path information. Correcting by the
// marker's outcome (IF) brings the fringe back: P(q[2] = 0) = cos²(θ/2).
// Drag θ (tap the θ badge) and compare q[0] with q[2] in PROB.

OPENQASM 3.0;
include "stdgates.inc";

input float theta;

qubit[4] q;
bit[4] c;

// Both interferometers: beam splitter, then phase θ in arm 1.
h q[0];
p(theta) q[0];
h q[2];
p(theta) q[2];

// Mark the path: each marker records which arm was taken.
cx q[0], q[1];
cx q[2], q[3];

// Recombine the first interferometer: no fringe, P(0) = 1/2.
h q[0];

// Erase: measure the second marker in the X basis…
h q[3];
c[3] = measure q[3];
// …and undo the phase it reveals, then recombine: the fringe is back.
if (c[3] == 1) z q[2];
h q[2];
