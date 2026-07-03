set -euo pipefail

command -v rserver
command -v cocalc-rstudio-server
Rscript --vanilla -e 'stopifnot(requireNamespace("shiny", quietly=TRUE)); stopifnot(requireNamespace("rmarkdown", quietly=TRUE))'
test -f /opt/cocalc-r/examples/shiny-hello/app.R

tmp="$(mktemp -d)"
chmod 1777 "$tmp"
port="${RSTUDIO_VERIFY_PORT:-6197}"
log="$tmp/rstudio.log"
cleanup() {
  if [ -n "${pid:-}" ] && kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT

if [ "$(id -u)" -eq 0 ] && id user >/dev/null 2>&1; then
  sudo -H -u user env HOST=127.0.0.1 PORT="$port" TMPDIR="$tmp" \
    cocalc-rstudio-server >"$log" 2>&1 &
else
  HOST=127.0.0.1 PORT="$port" TMPDIR="$tmp" cocalc-rstudio-server \
    >"$log" 2>&1 &
fi
pid="$!"

ready=false
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$port/" >/dev/null 2>&1; then
    ready=true
    break
  fi
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    cat "$log" >&2
    exit 1
  fi
  sleep 1
done

if [ "$ready" != "true" ]; then
  cat "$log" >&2
  exit 1
fi
