// Deferred measurement (6 qubits): the same teleportation done twice.
// q[0] → q[2] measures and corrects with IF, as in the lab; q[3] → q[5]
// replaces "measure, then correct if the bit is 1" by controlled gates
// from the unmeasured qubits. Both deliver the state set by θ: in BLOCH,
// q[2] and q[5] point the same way. Measurement can always be moved to
// the end of a circuit, with classical control becoming quantum control.

OPENQASM 3.0;
include "stdgates.inc";

input float theta;

qubit[6] q;
bit[6] c;

// The state to send, on q[0] and on q[3].
ry(theta) q[0];
rz(theta/2) q[0];
ry(theta) q[3];
rz(theta/2) q[3];

// Bell pairs: q[1]–q[2] and q[4]–q[5].
h q[1];
cx q[1], q[2];
h q[4];
cx q[4], q[5];

// Bell-basis rotation on both senders.
cx q[0], q[1];
h q[0];
cx q[3], q[4];
h q[3];

// With measurement: read the two bits, correct under IF.
c[0] = measure q[0];
c[1] = measure q[1];
if (c[1] == 1) x q[2];
if (c[0] == 1) z q[2];

// Deferred: the same corrections as controlled gates, no measurement.
cx q[4], q[5];
cz q[3], q[5];
