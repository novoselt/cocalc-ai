set -euo pipefail

command -v R
command -v Rscript
command -v jupyter
command -v jupyter-lab
command -v jupyter-notebook
Rscript --vanilla - <<'RS'
required <- c(
  "BiocManager", "car", "caret", "corrplot", "data.table", "devtools",
  "dplyr", "e1071", "forecast", "ggplot2", "IRkernel", "knitr", "lme4",
  "plotly", "psych", "randomForest", "remotes", "rmarkdown", "roxygen2",
  "shiny", "testthat", "tidyverse"
)
missing <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing)) {
  stop("Missing common R packages: ", paste(missing, collapse = ", "))
}
cat(R.version.string, "with", length(required), "verified packages\n")
RS
"${JUPYTER_PREFIX:-/opt/cocalc-r-jupyter}/bin/python" - <<'PY'
import ipykernel
import jupyterlab
PY
jupyter kernelspec list 2>/dev/null | grep -q ' ir\b\|/ir$'
