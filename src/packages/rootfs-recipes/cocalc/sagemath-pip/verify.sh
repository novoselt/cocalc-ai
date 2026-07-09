set -euo pipefail

prefix="${PREFIX:-/opt/sagemath-pip}"
extra_index_url="${EXTRA_INDEX_URL:-https://sagelite.sagemath.org/dev/simple/}"
kernel_name="${KERNEL_NAME:-sagemath}"
python_kernel_name="${PYTHON_KERNEL_NAME:-python3}"

command -v sage
command -v python
command -v pip
command -v jupyter
test -x "$prefix/bin/python"
test -x "$prefix/bin/sage"
test -f "$prefix/pip.conf"
grep -F "$extra_index_url" "$prefix/pip.conf"
sage --version
sage -c 'from sage.all import ZZ; assert ZZ(2) + ZZ(2) == 4'
python - <<'PY'
import sys
from sage.all import QQ, ZZ

assert ZZ(19).is_prime()
assert QQ(1, 2) + QQ(1, 3) == QQ(5, 6)
print(sys.executable)
PY
sage -python -c 'import PyNormaliz'
sage -c 'from sage.all import Polyhedron; P = Polyhedron(vertices=[(0,0),(1,0),(0,1)], backend="normaliz"); assert P.n_vertices() == 3'
pip --version
pip config debug 2>/dev/null | grep -F "$extra_index_url"
jupyter kernelspec list
jupyter kernelspec list 2>/dev/null | grep -qi "$kernel_name"
jupyter kernelspec list 2>/dev/null | grep -q "$python_kernel_name"
