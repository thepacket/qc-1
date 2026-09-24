/**
 * Security review (bugs #55–#59): untrusted input can't mutate the runtime,
 * blow up, hang the page, or reach the network or storage. The plot sandbox's
 * browser isolation (opaque origin, CSP) is checked in a browser; here, the
 * configuration that provides it and the paths that must refuse plot code.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { compileExpr, isSafeExpr } from "../src/sim/expr";
import { evalParam } from "../src/calc/steps";
import { importQasm, MAX_IMPORT_STEPS } from "../src/qasm/import";
import { Markdown } from "../src/ui/Markdown";
import { parseMatrix, parseState, TYPED_MAX_CHARS } from "../src/calc/typed";
import { executeTool, type AgentEnv } from "../src/ai/agent";

const FUNCS = ["sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "sqrt", "abs", "exp", "ln", "log", "pow"];
const qasm = (body: string, n = 2) => `OPENQASM 3.0; include "stdgates.inc"; qubit[${n}] q; ${body}`;
const timed = <T,>(f: () => T): { ms: number; v?: T; err?: string } => {
  const t0 = performance.now();
  try { const v = f(); return { ms: performance.now() - t0, v }; } catch (e) { return { ms: performance.now() - t0, err: String(e) }; }
};

describe("angle expressions are parsed, never run as code (#56)", () => {
  test("update and assignment forms of every math name are refused, and Math is untouched", () => {
    const before = FUNCS.map((f) => (Math as unknown as Record<string, unknown>)[f === "ln" ? "log" : f]);
    for (const f of FUNCS) {
      for (const src of [`${f}++`, `++${f}`, `${f}--`, `--${f}`, `${f}=1`, `${f}+=1`, `(${f})++`]) {
        expect(isSafeExpr(src), src).toBe(false);
        expect(() => importQasm(qasm(`rx(${src}) q[0];`))).toThrow();
      }
    }
    for (const src of ["sin++", "++cos", "sqrt--", "--tan"]) compileExpr(src).eval({});
    expect(FUNCS.map((f) => (Math as unknown as Record<string, unknown>)[f === "ln" ? "log" : f])).toEqual(before);
    expect(typeof Math.sin).toBe("function");
  });

  test("anything but arithmetic is refused: property access, strings, brackets, statements, functions, globals", () => {
    for (const src of ["Math.sin(1)", "a.b", "'x'", '"x"', "`x`", "[1][0]", "x;y", "()=>1", "this", "constructor", "__proto__",
      "globalThis", "self", "window", "eval(1)", "Function", "new Date", "import('x')", "x=1", "a,b", "sin", "foo(1)", "{}", "x!", "1 && 2", "$", "\\u0073in(1)"]) {
      expect(isSafeExpr(src), src).toBe(false);
    }
  });

  test("the arithmetic QC-1 uses still evaluates as before", () => {
    const cases: [string, Record<string, number>, number][] = [
      ["2*t + pi/4", { t: 1 }, 2 + Math.PI / 4], ["π/2", {}, Math.PI / 2], ["θ/2", { theta: 3 }, 1.5], ["sin(t)**2", { t: 0.3 }, Math.sin(0.3) ** 2],
      ["t > 0 ? 1 : -1", { t: -2 }, -1], ["pow(2, 10)", {}, 1024], ["1e-3*theta", { theta: 5 }, 0.005], [".5 + 2.", {}, 2.5],
      ["(1 + 2) * 3 % 4", {}, 1], ["3 - -2", {}, 5], ["e", {}, Math.E], ["E*PI", {}, Math.E * Math.PI], ["2**3**2", {}, 512],
      ["-2**2", {}, -4], ["sqrt(x**2 + y**2)", { x: 3, y: 4 }, 5], ["ln(e)", {}, 1], ["t >= 1 === (t > 0)", { t: 1 }, 1], ["unset + 1", {}, 1],
      ["acos(-1)", {}, Math.PI], ["abs(-3) + atan(1)*4", {}, 3 + Math.PI],
    ];
    for (const [src, scope, want] of cases) expect(compileExpr(src).eval(scope), src).toBeCloseTo(want, 12);
    expect(compileExpr("a*b + sin(c) + a").freeVars).toEqual(["a", "b", "c"]);
    expect(evalParam("theta", {})).toBeNaN(); // an undefined symbol is still NaN for the calculator
    expect(compileExpr("1/0").eval({})).toBe(0); // non-finite → 0, as before
  });

  test("a deeply nested or huge expression is refused, not a stack overflow", () => {
    expect(isSafeExpr("(".repeat(5000) + "1" + ")".repeat(5000))).toBe(false);
    expect(isSafeExpr("1+".repeat(3000) + "1")).toBe(false);
  });
});

describe("imports can't expand without bound (#57)", () => {
  const bombs: Record<string, string> = {
    pow: "pow(1000000000) @ x q[0];",
    "pow × pow": "pow(100000) @ pow(100000) @ x q[0];",
    ctrl: "ctrl(1000000000) @ x q[0], q[1];",
    "negative ctrl": "ctrl(-3) @ x q[0], q[1];",
    nested: (() => { let s = "gate g0 a { x a; }"; for (let k = 1; k <= 30; k++) s += ` gate g${k} a { g${k - 1} a; g${k - 1} a; }`; return `${s} g30 q[0];`; })(),
    "nested, parametric": (() => { let s = "gate g0(t) a { rx(t) a; }"; for (let k = 1; k <= 30; k++) s += ` gate g${k}(t) a { g${k - 1}(t) a; g${k - 1}(t+1) a; }`; return `${s} g30(0.1) q[0];`; })(),
    broadcast: `qubit[64] r; pow(20000) @ x r;`,
  };
  test.each(Object.entries(bombs))("%s is refused quickly", (_, body) => {
    const r = timed(() => importQasm(qasm(body)));
    expect(r.err).toBeDefined();
    // Bounded by the 100 000-step budget: parametric definitions expand inline, ~0.2 s alone, more under a parallel run.
    expect(r.ms).toBeLessThan(2000);
  });

  test("ordinary modifiers still import", () => {
    expect(importQasm(qasm("pow(3) @ x q[0]; inv @ ctrl @ rz(0.3) q[0], q[1];")).tape.length).toBe(4);
    expect(MAX_IMPORT_STEPS).toBeGreaterThanOrEqual(10_000);
  });
});

describe("chat Markdown always finishes (#58)", () => {
  test.each(["#", "#hashtag", "# ", "#### four", "   # indented", "#a\n#b\n#c", "text\n#tag\nmore", "##\n###\n", "|", "-", "```", "$$"])("%j renders", (src) => {
    const r = timed(() => renderToStaticMarkup(createElement(Markdown, { source: src })));
    expect(r.err).toBeUndefined();
    expect(r.ms).toBeLessThan(200);
  });

  test("real headings and hashtags both survive", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { source: "# Title\n#hashtag in a line" }));
    expect(html).toContain("md-h1");
    expect(html).toContain("#hashtag in a line");
  });
});

describe("typed states check their size before allocating (#59)", () => {
  test.each(["0".repeat(28), `|${"0".repeat(28)}⟩`, `|${"0".repeat(28)}⟩ + |${"1".repeat(28)}⟩`, "x".repeat(TYPED_MAX_CHARS + 1)])("%#: refused quickly", (src) => {
    const r = timed(() => parseState(src));
    expect(r.err).toBeDefined();
    expect(r.ms).toBeLessThan(50);
  });
  test("a long matrix text is refused; normal input still parses", () => {
    expect(() => parseMatrix("1,0;0,1;".repeat(4000))).toThrow();
    expect(parseState("|00⟩ + |11⟩").k).toBe(2);
    expect(parseState("0101").k).toBe(4);
  });
});

describe("plot programs (#55)", () => {
  const env: AgentEnv = { ...(() => { const r = importQasm(qasm("h q[0];")); return { n: r.n, tape: r.tape }; })(), scope: {}, noise: null, gates: [] };
  test("the assistant can't run plot code, and isn't offered it", async () => {
    const r = await executeTool("run_analysis", JSON.stringify({ id: "plotprogram", options: { code: "return 1" } }), env);
    expect(r.result).toMatch(/can't run/);
    const list = JSON.parse((await executeTool("list_analyses", "{}", env)).result) as { id: string }[];
    expect(list.some((a) => a.id === "plotprogram")).toBe(false);
  });

  test("the sandbox host gets a no-network, no-script-load policy; the site policy has no eval", () => {
    const host = readFileSync("deploy/plot-host-headers.conf", "utf8"), site = readFileSync("deploy/headers.conf", "utf8");
    const nginx = readFileSync("deploy/nginx.conf", "utf8"), docker = readFileSync("Dockerfile", "utf8");
    const hostCsp = /Content-Security-Policy "([^"]+)"/.exec(host)![1];
    expect(hostCsp).toContain("default-src 'none'");
    expect(hostCsp).not.toMatch(/connect-src|'self'|https?:/);
    expect(hostCsp).toContain("worker-src data:");
    expect(/Content-Security-Policy "([^"]+)"/.exec(site)![1]).not.toContain("unsafe-eval");
    expect(nginx).toMatch(/location ~ \^\/assets\/plotHost-.*plot-host-headers\.conf/s);
    expect(docker).toContain("plot-host-headers.conf");
    // Nothing but the sandbox runner compiles code at run time.
    const src = (p: string) => readFileSync(p, "utf8");
    expect(src("src/sim/expr.ts")).not.toMatch(/new Function\(/);
    expect(src("src/analysis/plotHost.ts")).toMatch(/origin !== "null"/); // the runner checks its isolation first
  });
});
