"""Run every reference generator (g_*.py) in this directory."""
import pathlib
import runpy
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

for script in sorted(HERE.glob("g_*.py")):
    print(f"{script.name}")
    runpy.run_path(str(script), run_name="__main__")
