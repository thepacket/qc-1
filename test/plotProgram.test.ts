import { describe, test, expect } from "vitest";
import { buildInput, sanitizeColor, sanitizePathD, sanitizePlotScene, PLOT_PRESETS } from "../src/analysis/plotProgram";
import { Register } from "../src/calc/register";

describe("plot program: sanitising what the code returns", () => {
  test("colours: literals and theme variables pass; anything that could carry CSS or a URL does not", () => {
    for (const ok of ["#3987e5", "rgb(1, 2, 3)", "hsla(10, 50%, 50%, 0.5)", "var(--series-2)", "teal", "none"]) expect(sanitizeColor(ok)).toBe(ok);
    for (const bad of ["url(http://x)", "var(--anything-else)", "red; background: url(x)", "expression(alert(1))", 3, null]) expect(sanitizeColor(bad)).toBe("var(--series-1)");
  });

  test("path data: commands and numbers only", () => {
    expect(sanitizePathD("M0 0 L10,10 Z")).toBe("M0 0 L10,10 Z");
    expect(sanitizePathD("M0 0 <script>")).toBeNull();
    expect(sanitizePathD("M0 0 url(#x)")).toBeNull();
  });

  test("scenes: unknown element types dropped, numbers clamped, text cut, no markup survives", () => {
    const r = sanitizePlotScene({
      width: 1e9, height: -5, title: "x".repeat(500),
      elements: [
        { type: "rect", x: NaN, y: 1e12, width: -3, height: 2, fill: "javascript:alert(1)" },
        { type: "script", src: "evil.js" },
        { type: "foreignObject", html: "<img onerror=alert(1)>" },
        { type: "text", x: 1, y: 2, text: "<b>hi</b>".repeat(100), size: 999 },
      ],
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.scene.width).toBe(2000);
    expect(r.scene.height).toBe(50);
    expect(r.scene.title).toHaveLength(120);
    expect(r.scene.elements.map((e) => e.type)).toEqual(["rect", "text"]);
    const [rect, text] = r.scene.elements as [Extract<typeof r.scene.elements[number], { type: "rect" }>, Extract<typeof r.scene.elements[number], { type: "text" }>];
    expect([rect.x, rect.y, rect.width, rect.fill]).toEqual([0, 1e6, 0, "var(--series-1)"]);
    expect(text.text).toHaveLength(200); // React renders it as text, never as markup
    expect(text.size).toBe(64);
    expect(sanitizePlotScene({ elements: [] })).toEqual({ error: "the scene has no drawable elements" });
    expect(sanitizePlotScene(42)).toEqual({ error: "the program did not return an object" });
  });
});

describe("plot program: input and presets", () => {
  test("the input carries the state, per-qubit ρ and the symbols", () => {
    const tape = [[{ id: "a", gateId: "h", column: 0, targets: [0], controls: [], clbits: [], params: [] }], [{ id: "b", gateId: "x", column: 1, targets: [1], controls: [0], clbits: [], params: [] }]];
    const reg = new Register(2, tape);
    const d = buildInput({ n: 2, state: reg.state, tape, scope: { t: 1 } });
    expect(d.prob.map((p) => +p.toFixed(12))).toEqual([0.5, 0, 0, 0.5]);
    expect(d.rho1[0].re.map((x) => +x.toFixed(12))).toEqual([0.5, 0, 0, 0.5]); // each qubit of a Bell pair is maximally mixed
    expect(d.scope).toEqual({ t: 1 });
  });

  test("every preset, run directly on a sample input, returns a scene that survives sanitising intact", () => {
    const reg = new Register(3, [[{ id: "a", gateId: "h", column: 0, targets: [0], controls: [], clbits: [], params: [] }]]);
    const data = buildInput({ n: 3, state: reg.state, tape: [], scope: {} });
    for (const p of PLOT_PRESETS) {
      const raw = new Function("data", `"use strict";\n${p.code}`)(data) as { elements: unknown[] };
      const r = sanitizePlotScene(raw);
      if ("error" in r) throw new Error(`${p.label}: ${r.error}`);
      expect(r.scene.elements.length, p.label).toBe(raw.elements.length);
    }
  });
});
