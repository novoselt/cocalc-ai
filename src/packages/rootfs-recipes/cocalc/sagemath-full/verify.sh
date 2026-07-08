set -euo pipefail

manifest="${OPTIONAL_MANIFEST:-/opt/cocalc-sagemath-full/optional-packages.json}"

command -v sage
command -v python
command -v pip
command -v jupyter
sage --version
sage -c 'from sage.all import ZZ; assert ZZ(2) + ZZ(2) == 4'
python -c 'from sage.all import ZZ; assert ZZ(19).is_prime()'
jupyter kernelspec list 2>/dev/null | grep -qi sagemath
jupyter kernelspec list 2>/dev/null | grep -q python3

test -s "$manifest"
python - "$manifest" <<'PY'
import json
import sys
from pathlib import Path

manifest = Path(sys.argv[1])
data = json.loads(manifest.read_text())
entries = data.get("entries", [])
assert entries, "optional package manifest has no entries"

missing_smoke = [
    entry["package"]
    for entry in entries
    if entry.get("install_status") == "installed"
    and entry.get("smoke_status") not in {"passed", "failed"}
]
assert not missing_smoke, f"installed packages missing smoke results: {missing_smoke}"

print(
    "optional package summary:",
    f"installed={len(data.get('installed', []))}",
    f"install_failed={len(data.get('install_failed', []))}",
    f"smoke_passed={len(data.get('smoke_passed', []))}",
    f"smoke_failed={len(data.get('smoke_failed', []))}",
)
PY

sage -python -c 'import PyNormaliz; print(PyNormaliz)'
sage -c 'from sage.geometry.polyhedron.constructor import Polyhedron; P = Polyhedron(vertices=[(0,0),(1,0),(0,1)], backend="normaliz"); assert P.n_vertices() == 3; print(P)'
