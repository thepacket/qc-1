// Pauli sums for tests, typed as a user types them (Qiskit's order, q0 rightmost).
import { parsePauliSum } from "../src/sim/trotter";
import { internalPauliSum } from "../src/calc/order";
export { pauliSumExpectation } from "../src/sim/expectation";
export const parsePauliSumFor = (text: string) => parsePauliSum(internalPauliSum(text));
