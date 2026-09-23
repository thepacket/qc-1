"""Compare regenerated fixtures with committed ones, numerically.

Byte-for-byte diffs flag last-digit differences between LAPACK builds
(macOS vs Linux) that are ~1e-15. Values must agree to 1e-10, or to the
fixture's own per-field tolerance where it states one (e.g. concurrence,
whose reference is conditioned only to ~sqrt(eps) on any platform).
Majorana stars are compared as a set (root order is platform-dependent).
Strings, structure and array lengths must match exactly (except the
instance ids of tape steps, which only number the generated steps).

usage: python drift.py <committed_dir> <regenerated_dir>
"""
import json
import math
import pathlib
import re
import sys

TOL = 1e-10


def unit(s):
    return (math.sin(s["theta"]) * math.cos(s["phi"]), math.sin(s["theta"]) * math.sin(s["phi"]), math.cos(s["theta"]))


def star_drift(a, b):
    left = [unit(s) for s in a]
    worst = 0.0
    for s in b:
        u = unit(s)
        d = [math.dist(u, w) for w in left]
        k = d.index(min(d))
        worst = max(worst, d[k])
        left.pop(k)
    return worst


FLOAT = re.compile(r"-?\d+\.\d{12,}(?:e[+-]?\d+)?")


def qasm_norm(text):
    """Long floats to 12 significant digits (last-bit libm differences across platforms)."""
    return FLOAT.sub(lambda m: repr(float(f"{float(m.group(0)):.12g}")), text)


def walk(path, a, b, bad, tol=TOL, tols=None):
    tols = tols or {}
    if isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            bad.append(f"{path}: keys differ")
            return
        for k in a:
            if k == "versions":  # environment metadata, not a reference value
                continue
            if k == "id" and ".tape[" in path:  # step instance ids: a generator counter
                continue
            if k == "stars":
                if len(a[k]) != len(b[k]) or star_drift(a[k], b[k]) > 5e-3:
                    bad.append(f"{path}.stars: constellation moved")
                continue
            if k == "qasm" and isinstance(a[k], str) and isinstance(b[k], str):
                if qasm_norm(a[k]) != qasm_norm(b[k]):
                    bad.append(f"{path}.qasm: program differs")
                continue
            walk(f"{path}.{k}", a[k], b[k], bad, max(TOL, tols.get(k, tol)), tols)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            bad.append(f"{path}: length {len(a)} vs {len(b)}")
            return
        for i, (x, y) in enumerate(zip(a, b)):
            walk(f"{path}[{i}]", x, y, bad, tol, tols)
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        if abs(a - b) > tol * max(1.0, abs(b)):
            bad.append(f"{path}: {a} vs {b}")
    elif a != b:
        bad.append(f"{path}: {a!r} vs {b!r}")


def main(old_dir, new_dir):
    old, new = pathlib.Path(old_dir), pathlib.Path(new_dir)
    names = sorted({p.name for p in old.glob("*.json")} | {p.name for p in new.glob("*.json")})
    failed = False
    for name in names:
        if not (old / name).exists() or not (new / name).exists():
            print(f"{name}: present on one side only")
            failed = True
            continue
        bad = []
        a, b = json.loads((old / name).read_text()), json.loads((new / name).read_text())
        tols = {k: v for k, v in a.get("meta", {}).get("tol", {}).items() if k != "abs"}
        walk(name, a, b, bad, TOL, tols)
        if bad:
            failed = True
            print(f"{name}: {len(bad)} drifted values, e.g.\n  " + "\n  ".join(bad[:10]))
        else:
            print(f"{name}: ok")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(*sys.argv[1:3])
