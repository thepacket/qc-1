import { test, expect } from "vitest";
import { toExpr, TOKENS, varToken } from "../src/calc/entry";
const e = (...ids: (string | [string])[]) => toExpr(ids.map((i) => (Array.isArray(i) ? varToken(i[0]) : TOKENS[i])));
test("implicit multiplication", () => {
  expect(e("3", "pi", "div", "4")).toBe("3*π/4");
  expect(e("2", ["θ"])).toBe("2*θ");
  expect(e("pi", "tsym")).toBe("π*t");
  expect(e(["θ"], "2")).toBe("θ*2");
  expect(e("1", "2", ".", "5")).toBe("12.5");
  expect(e("2", "sin", ["θ"], "rparen")).toBe("2*sin(θ)");
  expect(e("tsym", "div", "2")).toBe("t/2");
  expect(e("minus", ["φ"])).toBe("-φ");
});
