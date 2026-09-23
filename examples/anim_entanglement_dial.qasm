// Entanglement dial (2 qubits). RY(t) tips q[0] away from |0⟩ and a CX
// copies it onto q[1], so the pair is cos(t/2)|00⟩ + sin(t/2)|11⟩.
//
// As t turns, the pair goes from a product state (t = 0) to a Bell state
// (t = π/2), back to a product state |11⟩ (t = π), and round again.
// In BLOCH each qubit's vector has length |cos t|: it shrinks to the
// centre whenever the pair is maximally entangled, because each qubit on
// its own is then completely mixed. KET shows the two amplitudes trading.
//
// Play: tap the t badge in the status bar, then ▶.

OPENQASM 3.0;
include "stdgates.inc";

input float t;

qubit[2] q;

// Tip q[0]: cos(t/2)|0⟩ + sin(t/2)|1⟩.
ry(t) q[0];

// Copy it onto q[1]: cos(t/2)|00⟩ + sin(t/2)|11⟩ (entangled unless t is a multiple of π).
cx q[0], q[1];
