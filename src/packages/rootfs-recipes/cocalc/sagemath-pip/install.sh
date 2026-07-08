set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo -n"
fi

run_noninteractive() {
  if [ -n "$SUDO" ]; then
    $SUDO env DEBIAN_FRONTEND=noninteractive "$@"
  else
    DEBIAN_FRONTEND=noninteractive "$@"
  fi
}

bool_true() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | y | on) return 0 ;;
    *) return 1 ;;
  esac
}

log() {
  echo "[cocalc/sagemath-pip] $*"
}

write_exec_wrapper() {
  local target="$1"
  local command="$2"
  $SUDO mkdir -p "$(dirname "$target")"
  $SUDO rm -f "$target"
  $SUDO tee "$target" >/dev/null <<EOF
#!/usr/bin/env bash
exec $command "\$@"
EOF
  $SUDO chmod 755 "$target"
}

link_executable() {
  local source="$1"
  local target="$2"
  if [ -x "$source" ]; then
    $SUDO rm -f "$target"
    $SUDO ln -s "$source" "$target"
  fi
}

write_pip_conf() {
  local target="$1"
  $SUDO mkdir -p "$(dirname "$target")"
  $SUDO tee "$target" >/dev/null <<EOF
[global]
extra-index-url = $extra_index_url
EOF
  $SUDO chmod 644 "$target"
}

ensure_pip_extra_index() {
  local target="$1"
  local tmp
  tmp="$(mktemp)"
  if [ -f "$target" ]; then
    $SUDO cp "$target" "$tmp"
  fi
  "$python" - "$tmp" "$extra_index_url" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
url = sys.argv[2]
text = path.read_text() if path.exists() else ""

if url in text:
    path.write_text(text)
    raise SystemExit

lines = text.splitlines()
global_index = next(
    (i for i, line in enumerate(lines) if line.strip().lower() == "[global]"),
    None,
)

if global_index is None:
    if lines and lines[-1].strip():
        lines.append("")
    lines.extend(["[global]", f"extra-index-url = {url}"])
    path.write_text("\n".join(lines) + "\n")
    raise SystemExit

next_section = next(
    (
        i
        for i in range(global_index + 1, len(lines))
        if re.match(r"\s*\[[^]]+\]\s*$", lines[i])
    ),
    len(lines),
)

for i in range(global_index + 1, next_section):
    if re.match(r"\s*extra-index-url\s*=", lines[i], re.IGNORECASE):
        lines.insert(i + 1, f"    {url}")
        path.write_text("\n".join(lines) + "\n")
        raise SystemExit

lines.insert(global_index + 1, f"extra-index-url = {url}")
path.write_text("\n".join(lines) + "\n")
PY
  $SUDO install -m 644 "$tmp" "$target"
  rm -f "$tmp"
}

prefix="${PREFIX:-/opt/sagemath-pip}"
python="${PYTHON:-/usr/bin/python3.14}"
package="${PACKAGE:-sagelite==10.9.post8}"
extra_index_url="${EXTRA_INDEX_URL:-https://sagelite.sagemath.org/dev/simple/}"
configure_system_pip="${CONFIGURE_SYSTEM_PIP:-true}"
install_optional_wheel_ready="${INSTALL_OPTIONAL_WHEEL_READY:-false}"
optional_package="${OPTIONAL_PACKAGE:-sagelite[optional-wheel-ready]==10.9.post8}"
install_apt_packages="${INSTALL_APT_PACKAGES:-true}"
apt_packages="${APT_PACKAGES:-ca-certificates git python3-venv}"
python_kernel_name="${PYTHON_KERNEL_NAME:-python3}"
owner_uid="${OWNER_UID:-2001}"
owner_gid="${OWNER_GID:-2001}"

if ! command -v "$python" >/dev/null 2>&1 && [ ! -x "$python" ]; then
  echo "Python interpreter not found: $python" >&2
  echo "Install Python 3.14 first or set the recipe python input." >&2
  exit 1
fi

if bool_true "$install_apt_packages" && command -v apt-get >/dev/null 2>&1; then
  log "Installing apt prerequisites"
  $SUDO apt-get update
  # shellcheck disable=SC2086
  run_noninteractive apt-get install -y --no-install-recommends $apt_packages
  $SUDO rm -rf /var/lib/apt/lists/*
fi

if bool_true "$configure_system_pip"; then
  log "Configuring system pip to use $extra_index_url"
  ensure_pip_extra_index /etc/pip.conf
fi

log "Creating virtual environment at $prefix"
$SUDO mkdir -p "$prefix"
$SUDO chown -R "$(id -u):$(id -g)" "$prefix"
"$python" -m venv --clear "$prefix"
write_pip_conf "$prefix/pip.conf"

log "Installing $package"
"$prefix/bin/python" -m pip install --no-cache-dir --upgrade pip setuptools wheel
"$prefix/bin/python" -m pip install --no-cache-dir "$package"

if bool_true "$install_optional_wheel_ready"; then
  log "Installing $optional_package"
  "$prefix/bin/python" -m pip install --no-cache-dir "$optional_package"
fi

log "Exposing Sage/Python/Jupyter commands"
for exe in python python3; do
  write_exec_wrapper "/usr/local/bin/$exe" "\"$prefix/bin/python\""
done

for exe in pip pip3 sage jupyter jupyter-lab jupyter-notebook; do
  link_executable "$prefix/bin/$exe" "/usr/local/bin/$exe"
done

if [ -x "$prefix/bin/jupyter-kernelspec" ]; then
  link_executable "$prefix/bin/jupyter-kernelspec" /usr/local/bin/jupyter-kernelspec
fi

log "Installing Jupyter kernels"
$SUDO "$prefix/bin/python" -m ipykernel install \
  --prefix=/usr/local \
  --name "$python_kernel_name" \
  --display-name "Python ($(basename "$python"))"

$SUDO "$prefix/bin/python" - <<'PY'
from sage.repl.ipython_kernel.install import SageKernelSpec

SageKernelSpec.update(prefix="/usr/local")
PY

"$prefix/bin/python" -m pip cache purge >/dev/null 2>&1 || true
$SUDO chown -R "$owner_uid:$owner_gid" "$prefix"
$SUDO chmod -R u+rwX,go+rX "$prefix"

log "Installed wheel-first SageMath at $prefix"
