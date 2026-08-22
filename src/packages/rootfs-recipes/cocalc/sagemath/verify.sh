set -euo pipefail

prefix="${PREFIX:-/usr/local/sage}"

command -v sage
command -v python
command -v pip
command -v jupyter
sage --version
sage -c 'from sage.all import ZZ; assert ZZ(2) + ZZ(2) == 4'
python - <<'PY'
import sys
from sage.all import ZZ

assert ZZ(19).is_prime()
print(sys.executable)
PY
pip --version
jupyter kernelspec list
jupyter kernelspec list 2>/dev/null | grep -qi sagemath
jupyter kernelspec list 2>/dev/null | grep -q python3
python - "$prefix/sage" <<'PY'
import json
import sys
from pathlib import Path

sage = sys.argv[1]
for name in ("python3", "sagemath"):
    path = Path("/usr/local/share/jupyter/kernels") / name / "kernel.json"
    kernel = json.loads(path.read_text())
    assert kernel["argv"][:2] == [sage, "-python"], kernel
PY
sage_python="$(sage -python -c 'import sys; print(sys.executable)')"
env \
  -u CPATH \
  -u LIBRARY_PATH \
  -u PKG_CONFIG_PATH \
  -u SAGE_LIB \
  -u SAGE_LOCAL \
  -u SAGE_ROOT \
  -u SAGE_VENV \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  "$sage_python" - <<'PY'
from jupyter_client import KernelManager

manager = KernelManager(kernel_name="sagemath")
client = None
try:
    manager.start_kernel()
    client = manager.blocking_client()
    client.start_channels()
    client.wait_for_ready(timeout=30)
    reply = client.execute_interactive(
        "from sage.all import ZZ; assert ZZ(2) + ZZ(2) == 4",
        timeout=30,
    )
    assert reply["content"]["status"] == "ok", reply
finally:
    if client is not None:
        client.stop_channels()
    if manager.has_kernel:
        manager.shutdown_kernel(now=True)
PY
