// Bloch-sphere Lissajous figures (3 qubits). Each qubit's polar angle
// runs at t while its azimuth runs at a multiple of t, so the Bloch
// vector draws a closed curve on the sphere:
//
//   q[0]: azimuth 1·t: a tilted loop.
//   q[1]: azimuth 2·t: a figure of eight (Viviani's curve).
//   q[2]: azimuth 3·t: a three-lobed curve.
//
// Every curve closes when t comes round to 2π.
// Play: tap the t badge in the status bar, then ▶ (BLOCH view).

OPENQASM 3.0;
include "stdgates.inc";

input float t;

qubit[3] q;

// Polar angle t (from |0⟩ toward |+⟩), then azimuth t.
ry(t) q[0];
rz(t) q[0];

// Polar angle t, azimuth 2t.
ry(t) q[1];
rz(2*t) q[1];

// Polar angle t, azimuth 3t.
ry(t) q[2];
rz(3*t) q[2];
