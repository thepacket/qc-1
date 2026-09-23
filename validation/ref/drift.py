"""Compare regenerated fixtures with committed ones, numerically.

Byte-for-byte diffs flag last-digit differences between LAPACK builds
(macOS vs Linux) that are ~1e-15. Values must agree to 1e-10; strings,
structure and array lengths must match exactly.

usage: python drift.py <committed_dir> <regenerated_dir>
"""
import json
import pathlib
import sys

TOL = 1e-10


def walk(path, a, b, bad):
    if isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            bad.append(f"{path}: keys differ")
            return
        for k in a:
            if k == "versions":  # environment metadata, not a reference value
                continue
            walk(f"{path}.{k}", a[k], b[k], bad)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            bad.append(f"{path}: length {len(a)} vs {len(b)}")
            return
        for i, (x, y) in enumerate(zip(a, b)):
            walk(f"{path}[{i}]", x, y, bad)
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        if abs(a - b) > TOL * max(1.0, abs(b)):
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
        walk(name, json.loads((old / name).read_text()), json.loads((new / name).read_text()), bad)
        if bad:
            failed = True
            print(f"{name}: {len(bad)} drifted values, e.g.\n  " + "\n  ".join(bad[:10]))
        else:
            print(f"{name}: ok")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(*sys.argv[1:3])
