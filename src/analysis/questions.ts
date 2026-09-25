/** Curated routes into the catalog, with the limits needed to interpret the answers. */
export const LAB_QUESTIONS = [
  { title: "Are these qubits entangled?", note: "Pairwise measures can miss multipartite entanglement. With noise enabled, these panels use mixed density matrices. Hardware experiment reconstructs them by tomography.", ids: ["negativity", "concurrence", "density"] },
  { title: "What did noise change?", note: "Enable and configure the Noise model first. These panels compare the model's noisy state with the ideal circuit.", ids: ["noisemodel", "noisecompare", "impact", "mixedspectrum", "decoherence"] },
  { title: "Are these circuits equivalent?", note: "Store a reference circuit in memory (STO), then compare it with the current circuit. Matching one output state alone does not establish operator equivalence.", ids: ["compare"] },
];
