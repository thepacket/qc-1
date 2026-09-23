// Repetition code with 25 data qubits and 24 syndrome qubits (49 in all,
// stabilizer mode). The data q[0..24] hold a logical |+⟩ =
// (|00…0⟩ + |11…1⟩)/√2, protected against bit flips. A bit flip hits
// q[12]; each syndrome qubit q[25+i] then measures the parity Zᵢ Zᵢ₊₁ of
// two neighbouring data qubits.
//
// The two syndrome bits next to the error, c[36] and c[37] (checking
// pairs 11–12 and 12–13), come out 1, and all the others 0: the pattern
// points at q[12] without measuring (or disturbing) the logical state.
// Scrub back to the error in TAPE, DEL it or key X on another data
// qubit, and the syndrome moves with it.

OPENQASM 3.0;
include "stdgates.inc";

qubit[49] q;
bit[49] c;

// Encode the logical |+⟩ across the 25 data qubits.
h q[0];
cx q[0], q[1];
cx q[1], q[2];
cx q[2], q[3];
cx q[3], q[4];
cx q[4], q[5];
cx q[5], q[6];
cx q[6], q[7];
cx q[7], q[8];
cx q[8], q[9];
cx q[9], q[10];
cx q[10], q[11];
cx q[11], q[12];
cx q[12], q[13];
cx q[13], q[14];
cx q[14], q[15];
cx q[15], q[16];
cx q[16], q[17];
cx q[17], q[18];
cx q[18], q[19];
cx q[19], q[20];
cx q[20], q[21];
cx q[21], q[22];
cx q[22], q[23];
cx q[23], q[24];

// The error: a bit flip on data qubit 12.
x q[12];

// Syndrome extraction: syndrome qubit 25+i collects the parity of data qubits i and i+1.
cx q[0], q[25];
cx q[1], q[25];
cx q[1], q[26];
cx q[2], q[26];
cx q[2], q[27];
cx q[3], q[27];
cx q[3], q[28];
cx q[4], q[28];
cx q[4], q[29];
cx q[5], q[29];
cx q[5], q[30];
cx q[6], q[30];
cx q[6], q[31];
cx q[7], q[31];
cx q[7], q[32];
cx q[8], q[32];
cx q[8], q[33];
cx q[9], q[33];
cx q[9], q[34];
cx q[10], q[34];
cx q[10], q[35];
cx q[11], q[35];
cx q[11], q[36];
cx q[12], q[36];
cx q[12], q[37];
cx q[13], q[37];
cx q[13], q[38];
cx q[14], q[38];
cx q[14], q[39];
cx q[15], q[39];
cx q[15], q[40];
cx q[16], q[40];
cx q[16], q[41];
cx q[17], q[41];
cx q[17], q[42];
cx q[18], q[42];
cx q[18], q[43];
cx q[19], q[43];
cx q[19], q[44];
cx q[20], q[44];
cx q[20], q[45];
cx q[21], q[45];
cx q[21], q[46];
cx q[22], q[46];
cx q[22], q[47];
cx q[23], q[47];
cx q[23], q[48];
cx q[24], q[48];

// Read the syndrome.
c[25] = measure q[25];
c[26] = measure q[26];
c[27] = measure q[27];
c[28] = measure q[28];
c[29] = measure q[29];
c[30] = measure q[30];
c[31] = measure q[31];
c[32] = measure q[32];
c[33] = measure q[33];
c[34] = measure q[34];
c[35] = measure q[35];
c[36] = measure q[36];
c[37] = measure q[37];
c[38] = measure q[38];
c[39] = measure q[39];
c[40] = measure q[40];
c[41] = measure q[41];
c[42] = measure q[42];
c[43] = measure q[43];
c[44] = measure q[44];
c[45] = measure q[45];
c[46] = measure q[46];
c[47] = measure q[47];
c[48] = measure q[48];
