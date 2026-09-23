"""Phase 7 references: the example programs (examples/*.qasm), read by Qiskit.

Each ORIGINAL example file (not QC-1's re-export) is loaded with
qiskit.qasm3.loads after the minimum normalisation Qiskit's importer needs,
none of which changes the program:
  * `if (c[k] == 1)` → `== true` (the importer rejects bit == int);
  * the time symbol `t` → `t_` inside parameter lists and its declaration
    (`t` is also the T gate in stdgates.inc);
  * symbols used without `input float` get one (upstream allowed that);
  * non-stdgates gates used without a definition (rzz, xx_plus_yy, …) get
    Qiskit's own definition of its library gate (qasm3.dumps of RZZGate, …).
Symbols are bound to the same values as QC-1. Programs whose measurements
are all final compare statevectors with them removed (exact, global phase
included); dynamic ones compare every measurement history (enumerator from
g_classical). Programs above 20 qubits run in QC-1's stabilizer mode: every
QC-1 generator must have expectation +1 in Qiskit's StabilizerState of the
program (final measurements removed), and the n generators must be
independent. QC-1's re-export of its import must also load in Qiskit.
"""
import json
import re

import numpy as np
from qiskit import QuantumCircuit, qasm3
from qiskit.circuit import Parameter
from qiskit.circuit.library import (CCZGate, SXdgGate, DCXGate, ECRGate, RXXGate, RYYGate, RZXGate, RZZGate, XXMinusYYGate,
                                    XXPlusYYGate, iSwapGate)
from qiskit.quantum_info import Statevector

from common import OUT, cvec, fail, r, write_fixture
from g_classical import branches
from g_stabilizer import clifford_of
from g_tools import gf2_rank
from qiskit.quantum_info import Pauli, StabilizerState

LIBRARY = {
    "rzz": (RZZGate, 1, 2), "rxx": (RXXGate, 1, 2), "ryy": (RYYGate, 1, 2), "rzx": (RZXGate, 1, 2),
    "xx_plus_yy": (XXPlusYYGate, 2, 2), "xx_minus_yy": (XXMinusYYGate, 2, 2),
    "iswap": (iSwapGate, 0, 2), "dcx": (DCXGate, 0, 2), "ecr": (ECRGate, 0, 2), "ccz": (CCZGate, 0, 3), "sxdg": (SXdgGate, 0, 1),
}


def qiskit_definitions(name):
    """Qiskit's definition of its library gate, with the definitions it depends on (in order).

    qasm3.dumps drops a definition's global phase (SXdgGate dumps as `s; h; s`,
    missing e^{-iπ/4}); each block is checked against the gate's Operator and
    the lost phase is put back with gphase (it must not depend on parameters).
    """
    from qiskit.quantum_info import Operator
    cls, npar, nq = LIBRARY[name]
    qc = QuantumCircuit(nq)
    qc.append(cls(*[Parameter(f"p{i}") for i in range(npar)]), range(nq))
    text = qasm3.dumps(qc)
    blocks = re.findall(r"gate \w+[^{]*\{[^}]*\}", text)
    if not any(re.match(r"gate " + name + r"\b", b) for b in blocks):
        fail(f"no Qiskit definition text for {name}")
    fixed = []
    for block in blocks:
        head = re.match(r"gate (\w+)", block).group(1)
        ref_cls = {v[0]().name if v[1] == 0 else v[0](*([0.1] * v[1])).name: v for v in LIBRARY.values()}.get(head)
        if ref_cls is None:
            fixed.append(block)
            continue
        c2, np2, nq2 = ref_cls
        phases = []
        for vals in ([0.3, 0.7], [1.1, -0.4]):
            prog = 'OPENQASM 3.0; include "stdgates.inc";\n' + "\n".join(fixed + [block]) + f"\nqubit[{nq2}] q; {head}" + \
                (f"({', '.join(str(v) for v in vals[:np2])})" if np2 else "") + " " + ", ".join(f"q[{i}]" for i in range(nq2)) + ";"
            got = Operator(qasm3.loads(prog)).data
            want = Operator(c2(*vals[:np2])).data
            k = np.unravel_index(np.argmax(np.abs(want)), want.shape)
            phases.append(np.angle(want[k] / got[k]))
        if abs(np.exp(1j * phases[0]) - np.exp(1j * phases[1])) > 1e-9:
            fail(f"{head}: definition phase depends on parameters")
        if abs(phases[0]) > 1e-12:
            block = block[:-1].rstrip() + f"\n  gphase({float(phases[0])!r});\n}}"
        fixed.append(block)
    return fixed


def normalise(src, symbols):
    src = re.sub(r"/\*[\s\S]*?\*/", "", re.sub(r"//[^\n]*", "", src))  # comments play no part
    out = re.sub(r"if\s*\(([^)]*?)==\s*1\s*\)", r"if (\1== true)", src)
    out = re.sub(r"if\s*\(([^)]*?)==\s*0\s*\)", r"if (\1== false)", out)
    code = re.sub(r"//[^\n]*", "", out)
    if "t" in symbols:
        out = re.sub(r"input\s+float\s+t\s*;", "input float t_;", out)
        # Innermost parenthesised groups, repeatedly: parameter lists and sub-expressions.
        def sub_t(m):
            return re.sub(r"\bt\b", "t_", m.group(0))
        prev = None
        while prev != out:
            prev = out
            out = re.sub(r"\([^()]*\)", lambda m: sub_t(m).replace("(", "\x00").replace(")", "\x01"), out)
        out = out.replace("\x00", "(").replace("\x01", ")")
    # The importer can't evaluate function calls: fold symbol-free parameter
    # expressions that use one (real division, as the examples intend).
    import math
    env = {k: getattr(math, k) for k in ("sqrt", "acos", "asin", "atan", "sin", "cos", "tan", "exp", "log")}
    env.update(pi=math.pi, ln=math.log, arccos=math.acos, arcsin=math.asin, arctan=math.atan)

    def fold(m):
        inner = m.group(1)
        if not re.search(r"\b(sqrt|acos|asin|atan|arccos|arcsin|arctan|sin|cos|tan|exp|ln|log)\s*\(", inner):
            return m.group(0)
        parts = []
        for e in split_top(inner):
            idents = set(re.findall(r"[A-Za-z_]\w*", e)) - set(env)
            parts.append(e if idents else repr(float(eval(e.replace("π", "pi"), {"__builtins__": {}}, env))))
        return m.group(0)[: m.start(1) - m.start(0)] + ", ".join(parts) + ")"
    out = re.sub(r"(?<=[a-z0-9_])\s*\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)", fold, out)
    declared = set(re.findall(r"input\s+float\s+(\w+)\s*;", out))
    decls = [f"input float {'t_' if s == 't' else s};" for s in symbols if ('t_' if s == 't' else s) not in declared]
    used = set(re.findall(r"^\s*(?:(?:neg)?ctrl(?:\(\d+\))?\s*@\s*)*([a-z_0-9]+)\s*[\(\s]", code, re.M))
    defined = set(re.findall(r"gate\s+(\w+)", code))
    defs = []
    for g in sorted(used & set(LIBRARY) - defined):
        for block in qiskit_definitions(g):
            head = re.match(r"gate (\w+)", block).group(1)
            if head not in defined and all(not d.startswith(f"gate {head} ") and not d.startswith(f"gate {head}(") for d in defs):
                defs.append(block)
    head = re.search(r'include\s+"stdgates.inc"\s*;', out)
    at = head.end() if head else re.search(r"OPENQASM[^;]*;", out).end()
    return out[:at] + "\n" + "\n".join(defs + decls) + "\n" + out[at:]


def split_top(text):
    """Split an argument list at top-level commas."""
    out, depth, cur = [], 0, ""
    for ch in text:
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
            continue
        depth += ch == "("
        depth -= ch == ")"
        cur += ch
    out.append(cur)
    return [x.strip() for x in out]


def bind(qc, scope):
    ps = {p.name: p for p in qc.parameters}
    missing = [n for n in ps if (n[:-1] if n == "t_" else n) not in scope]
    if missing:
        fail(f"unbound parameters {missing}")
    return qc.assign_parameters({ps[n]: scope["t" if n == "t_" else n] for n in ps})


def main():
    doc = json.load(open(OUT / "examples.cases.json"))
    out, worst = [], 0.0
    for c in doc["cases"]:
        src = open(OUT.parent.parent / "examples" / c["file"]).read()
        try:
            qc = qasm3.loads(normalise(src, c["symbols"]))
        except Exception as e:
            fail(f"examples {c['file']}: Qiskit can't load the normalised original: {e}")
        qc = bind(qc, c["scope"])
        if qc.num_qubits != c["n"]:
            fail(f"examples {c['file']}: {qc.num_qubits} qubits vs QC-1 {c['n']}")
        entry = {"id": c["id"], "file": c["file"], "n": c["n"], "kind": c["kind"], "scope": c["scope"]}
        if c["kind"] == "stabilizer":
            st = StabilizerState(clifford_of(qc.remove_final_measurements(inplace=False)))
            for g in c["generators"]:
                # QC-1 labels are big-endian (qubit 0 first); Qiskit's Pauli labels are little-endian.
                ev = st.expectation_value(Pauli(("-" if g[0] == "-" else "") + g[1:][::-1]))
                if abs(ev - 1) > 1e-12:
                    fail(f"examples {c['file']}: <{g[:16]}…> = {ev}")
            bits = [[1 if p in "XY" else 0 for p in g[1:]] + [1 if p in "ZY" else 0 for p in g[1:]] for g in c["generators"]]
            if gf2_rank(bits) != c["n"]:
                fail(f"examples {c['file']}: generators not independent")
            entry["generators"] = c["generators"]
        elif c["kind"] == "state":
            ref = Statevector(qc.remove_final_measurements(inplace=False)).reverse_qargs().data
            mine = np.array(c["state"][0::2]) + 1j * np.array(c["state"][1::2])
            err = float(np.max(np.abs(ref - mine)))
            worst = max(worst, err)
            if err > 1e-9:
                fail(f"examples {c['file']}: statevector differs by {err:.2e}")
            if c["n"] <= 10:
                entry["state"] = cvec(ref)
            else:
                top = np.argsort(-np.abs(ref), kind="stable")[:16]
                entry["top"] = [[int(i), r(ref[i].real), r(ref[i].imag)] for i in sorted(top)]
        else:
            ref = branches(qc, c["n"])
            mine = {b["path"]: (b["p"], b["cbits"]) for b in c["branches"]}
            if set(ref) != set(mine):
                fail(f"examples {c['file']}: histories {sorted(mine)[:6]} vs {sorted(ref)[:6]}")
            for k, (p, _) in ref.items():
                worst = max(worst, abs(mine[k][0] - p))
                if abs(mine[k][0] - p) > 1e-9:
                    fail(f"examples {c['file']}: history {k}: {mine[k][0]} vs {p}")
            entry["branches"] = [{"path": k, "p": r(p)} for k, (p, _) in sorted(ref.items())]
        try:
            qasm3.loads(c["exported"])
        except Exception as e:
            fail(f"examples {c['file']}: QC-1's re-export doesn't load in Qiskit: {e}")
        out.append(entry)
    print(f"  examples: {len(out)} programs, worst difference {worst:.2e}")
    write_fixture("examples", "qiskit.qasm3.loads of each original (normalised for the importer) → Statevector / measurement histories", out, {"abs": 1e-9})


if __name__ == "__main__":
    main()
