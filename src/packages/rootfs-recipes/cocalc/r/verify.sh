set -euo pipefail

command -v R
command -v Rscript
command -v jupyter
command -v jupyter-lab
command -v jupyter-notebook
Rscript --vanilla -e 'stopifnot(requireNamespace("IRkernel", quietly=TRUE)); cat(R.version.string, "\n")'
"${JUPYTER_PREFIX:-/opt/cocalc-r-jupyter}/bin/python" - <<'PY'
import ipykernel
import jupyterlab
PY
jupyter kernelspec list 2>/dev/null | grep -q ' ir\b\|/ir$'
