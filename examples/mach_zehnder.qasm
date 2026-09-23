// Mach–Zehnder interferometer (1 qubit). |0⟩ and |1⟩ are the two arms. The
// first Hadamard is a beam splitter, the phase θ is a path-length
// difference in one arm, the second Hadamard recombines the beams.
// The detector for arm 0 fires with P(0) = cos²(θ/2): drag θ (tap the θ
// badge) and the fringe swings between 1 and 0.

OPENQASM 3.0;
include "stdgates.inc";

input float theta;

qubit[1] q;

// First beam splitter: both arms at once.
h q[0];

// Phase shifter in arm 1.
p(theta) q[0];

// Second beam splitter: the arms interfere. P(0) = cos²(θ/2).
h q[0];
