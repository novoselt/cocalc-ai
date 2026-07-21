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

method="${METHOD:-source}"
version="${VERSION:-10.9}"
source_url="${SOURCE_URL:-https://github.com/sagemath/sage.git}"
prefix="${PREFIX:-/usr/local/sage}"
build_dir="${BUILD_DIR:-/tmp/cocalc-sagemath-build}"
jobs="${JOBS:-auto}"
clean_build_dir="${CLEAN_BUILD_DIR:-true}"
clone_depth="${CLONE_DEPTH:-1}"
preserve_build_artifacts="${PRESERVE_BUILD_ARTIFACTS:-false}"
install_recommended_apt_packages="${INSTALL_RECOMMENDED_APT_PACKAGES:-true}"
install_sagetex="${INSTALL_SAGETEX:-true}"
priority_optional_packages="${PRIORITY_OPTIONAL_PACKAGES:-}"
optional_packages="${OPTIONAL_PACKAGES:-}"
x86_64_optional_packages="${X86_64_OPTIONAL_PACKAGES:-}"
optional_manifest="${OPTIONAL_MANIFEST:-/opt/cocalc-sagemath-full/optional-packages.json}"
optional_log_dir="${OPTIONAL_LOG_DIR:-/opt/cocalc-sagemath-full/logs}"
micromamba_prefix="${MICROMAMBA_PREFIX:-/opt/micromamba}"
conda_packages="${CONDA_PACKAGES:-sage}"
owner_uid="${OWNER_UID:-2001}"
owner_gid="${OWNER_GID:-2001}"

log() {
  echo "[cocalc/sagemath] $*"
}

write_exec_wrapper() {
  local target="$1"
  local command="$2"
  $SUDO mkdir -p "$(dirname "$target")"
  # Replace the path itself instead of following an existing symlink into the
  # base image, e.g. /usr/local/bin/python -> /opt/cocalc-jupyter/bin/python.
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

pin_python_venv_link() {
  local python_path="$1"
  local target
  local resolved
  if [ ! -L "$python_path" ]; then
    return
  fi
  target="$(readlink "$python_path")"
  case "$target" in
    /usr/local/bin/python | /usr/local/bin/python3 | /usr/local/bin/python3.*)
      resolved="$(readlink -f "$python_path")"
      if [ -z "$resolved" ] || [ ! -x "$resolved" ]; then
        echo "Cannot resolve Sage Python link: $python_path -> $target" >&2
        exit 1
      fi
      log "Retargeting Sage Python venv link ${python_path} from ${target} to ${resolved}"
      $SUDO rm -f "$python_path"
      $SUDO ln -s "$resolved" "$python_path"
      ;;
  esac
}

apt_install_available() {
  local packages=()
  local package
  for package in "$@"; do
    if apt-cache show "$package" >/dev/null 2>&1; then
      packages+=("$package")
    else
      log "Skipping unavailable apt package: $package"
    fi
  done
  if [ "${#packages[@]}" -gt 0 ]; then
    run_noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
  fi
}

has_optional_packages() {
  [ -n "$priority_optional_packages$optional_packages$x86_64_optional_packages" ]
}

record_optional_result() {
  local package="$1"
  local group="$2"
  local install_status="$3"
  local install_log_path="$4"
  local install_exit_code="$5"
  local smoke_status="$6"
  local smoke_kind="$7"
  local smoke_log_path="$8"
  local smoke_exit_code="$9"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$package" \
    "$group" \
    "$install_status" \
    "$install_log_path" \
    "$install_exit_code" \
    "$smoke_status" \
    "$smoke_kind" \
    "$smoke_log_path" \
    "$smoke_exit_code" >>"$optional_manifest.tmp"
}

run_python_smoke() {
  local sage_bin="$1"
  local package="$2"
  local import_name="$3"
  local log_path="$4"
  "$sage_bin" -python - "$import_name" >"$log_path" 2>&1 <<'PY'
import importlib
import sys

name = sys.argv[1]
module = importlib.import_module(name)
print(f"imported {name} from {getattr(module, '__file__', '(built-in)')}")
PY
}

run_sage_smoke() {
  local sage_bin="$1"
  local script="$2"
  local log_path="$3"
  "$sage_bin" -c "$script" >"$log_path" 2>&1
}

run_command_smoke() {
  local command="$1"
  local log_path="$2"
  bash -lc "$command" >"$log_path" 2>&1
}

run_metadata_smoke() {
  local sage_bin="$1"
  local prefix="$2"
  local package="$3"
  local log_path="$4"
  "$sage_bin" --package properties "$package" >"$log_path" 2>&1
  {
    echo
    echo "Installed package records:"
    find "$prefix/local/var/lib/sage/installed" -maxdepth 1 -type f -name "${package}*" -print
  } >>"$log_path" 2>&1
  find "$prefix/local/var/lib/sage/installed" -maxdepth 1 -type f -name "${package}*" | grep -q .
}

smoke_optional_package() {
  local package="$1"
  local sage_bin="$2"
  local log_path="$optional_log_dir/${package}.smoke.log"
  local smoke_kind="metadata"
  local exit_code

  set +e
  case "$package" in
    admcycles) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" admcycles "$log_path" ;;
    biopython) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" Bio "$log_path" ;;
    debugpy) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" debugpy "$log_path" ;;
    dot2tex) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" dot2tex "$log_path" ;;
    ecos_python) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" ecos "$log_path" ;;
    gitpython) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" git "$log_path" ;;
    igraph | python_igraph) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" igraph "$log_path" ;;
    ipympl) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" ipympl "$log_path" ;;
    jupyterlab) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" jupyterlab "$log_path" ;;
    mathics) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" mathics "$log_path" ;;
    nibabel) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" nibabel "$log_path" ;;
    normaliz) smoke_kind="sage-normaliz-polyhedron"; run_sage_smoke "$sage_bin" 'from sage.geometry.polyhedron.constructor import Polyhedron; P = Polyhedron(vertices=[(0,0),(1,0),(0,1)], backend="normaliz"); assert P.n_vertices() == 3; print(P)' "$log_path" ;;
    notedown) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" notedown "$log_path" ;;
    osqp_python) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" osqp "$log_path" ;;
    pybtex) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" pybtex "$log_path" ;;
    pycosat) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" pycosat "$log_path" ;;
    pycryptosat) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" pycryptosat "$log_path" ;;
    pynormaliz) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" PyNormaliz "$log_path" ;;
    pytest) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" pytest "$log_path" ;;
    pytest_mock) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" pytest_mock "$log_path" ;;
    python_build) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" build "$log_path" ;;
    pyx) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" pyx "$log_path" ;;
    qdldl_python) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" qdldl "$log_path" ;;
    slabbe) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" slabbe "$log_path" ;;
    snappy) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" snappy "$log_path" ;;
    sqlalchemy) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" sqlalchemy "$log_path" ;;
    texttable) smoke_kind="python-import"; run_python_smoke "$sage_bin" "$package" texttable "$log_path" ;;
    gap_jupyter) smoke_kind="jupyter-kernelspec"; run_command_smoke "jupyter kernelspec list | grep -qi gap" "$log_path" ;;
    singular_jupyter) smoke_kind="jupyter-kernelspec"; run_command_smoke "jupyter kernelspec list | grep -qi singular" "$log_path" ;;
    fricas) smoke_kind="command"; run_command_smoke "command -v fricas" "$log_path" ;;
    *) smoke_kind="metadata"; run_metadata_smoke "$sage_bin" "$prefix" "$package" "$log_path" ;;
  esac
  exit_code="$?"
  set -e

  if [ "$exit_code" -eq 0 ]; then
    printf 'passed\t%s\t%s\t0\n' "$smoke_kind" "$log_path"
  else
    printf 'failed\t%s\t%s\t%s\n' "$smoke_kind" "$log_path" "$exit_code"
  fi
  return 0
}

install_optional_package() {
  local package="$1"
  local group="$2"
  local sage_bin="$3"
  local make_jobs="$4"
  local log_path

  log_path="$optional_log_dir/${package}.log"
  log "Installing optional Sage package ${package} (${group})"
  if MAKE="make -j${make_jobs}" "$sage_bin" -i "$package" >"$log_path" 2>&1; then
    log "Installed optional Sage package ${package}"
    local smoke_result
    local smoke_status
    local smoke_kind
    local smoke_log_path
    local smoke_exit_code
    smoke_result="$(smoke_optional_package "$package" "$sage_bin")"
    IFS=$'\t' read -r smoke_status smoke_kind smoke_log_path smoke_exit_code <<<"$smoke_result"
    record_optional_result "$package" "$group" installed "$log_path" 0 "$smoke_status" "$smoke_kind" "$smoke_log_path" "$smoke_exit_code"
    if [ "$smoke_status" = "passed" ]; then
      log "Smoke test passed for optional Sage package ${package} (${smoke_kind})"
    else
      log "Smoke test failed for optional Sage package ${package} (${smoke_kind}); continuing"
      tail -n 40 "$smoke_log_path" || true
    fi
    return 0
  fi

  local exit_code="$?"
  record_optional_result "$package" "$group" failed "$log_path" "$exit_code" skipped install-failed "" 0
  log "Optional Sage package ${package} failed with exit code ${exit_code}; continuing"
  tail -n 40 "$log_path" || true
  return 0
}

install_optional_group() {
  local group="$1"
  local sage_bin="$2"
  local make_jobs="$3"
  shift 3
  local package

  for package in "$@"; do
    if [ -z "$package" ]; then
      continue
    fi
    install_optional_package "$package" "$group" "$sage_bin" "$make_jobs"
  done
}

write_optional_manifest() {
  $SUDO mkdir -p "$(dirname "$optional_manifest")"
  if [ ! -f "$optional_manifest.tmp" ]; then
    : >"$optional_manifest.tmp"
  fi
  python3 - "$optional_manifest.tmp" "$optional_manifest" <<'PY'
import json
import sys
from pathlib import Path

source = Path(sys.argv[1])
target = Path(sys.argv[2])
entries = []
for line in source.read_text().splitlines():
    if not line.strip():
        continue
    (
        package,
        group,
        install_status,
        install_log_path,
        install_exit_code,
        smoke_status,
        smoke_kind,
        smoke_log_path,
        smoke_exit_code,
    ) = line.split("\t", 8)
    entries.append(
        {
            "package": package,
            "group": group,
            "install_status": install_status,
            "install_log_path": install_log_path,
            "install_exit_code": int(install_exit_code),
            "smoke_status": smoke_status,
            "smoke_kind": smoke_kind,
            "smoke_log_path": smoke_log_path,
            "smoke_exit_code": int(smoke_exit_code),
        }
    )

target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(
    json.dumps(
        {
            "version": 1,
            "installed": [entry for entry in entries if entry["install_status"] == "installed"],
            "install_failed": [entry for entry in entries if entry["install_status"] == "failed"],
            "smoke_passed": [entry for entry in entries if entry["smoke_status"] == "passed"],
            "smoke_failed": [entry for entry in entries if entry["smoke_status"] == "failed"],
            "entries": entries,
        },
        indent=2,
        sort_keys=True,
    )
    + "\n"
)
PY
  rm -f "$optional_manifest.tmp"
}

install_sage_optionals() {
  local sage_bin="$1"
  local make_jobs="$2"
  local arch

  if ! has_optional_packages; then
    return
  fi

  log "Installing best-effort optional Sage packages"
  $SUDO mkdir -p "$optional_log_dir"
  $SUDO chown -R "$(id -u):$(id -g)" "$(dirname "$optional_manifest")"
  : >"$optional_manifest.tmp"

  install_optional_group priority "$sage_bin" "$make_jobs" $priority_optional_packages
  install_optional_group default "$sage_bin" "$make_jobs" $optional_packages

  arch="$(uname -m)"
  case "$arch" in
    x86_64 | amd64)
      install_optional_group x86_64 "$sage_bin" "$make_jobs" $x86_64_optional_packages
      ;;
    *)
      log "Skipping x86_64-only optional Sage packages on architecture ${arch}: ${x86_64_optional_packages}"
      ;;
  esac

  write_optional_manifest
  log "Wrote optional Sage package manifest to ${optional_manifest}"
}

install_apt_sage() {
  $SUDO apt-get update
  run_noninteractive apt-get install -y --no-install-recommends ${PACKAGES:?packages are required}
  $SUDO rm -rf /var/lib/apt/lists/*
}

install_micromamba_sage() {
  local arch
  local mamba_arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64) mamba_arch="linux-64" ;;
    aarch64 | arm64) mamba_arch="linux-aarch64" ;;
    *)
      echo "unsupported architecture for micromamba: $arch" >&2
      exit 1
      ;;
  esac

  $SUDO apt-get update
  apt_install_available bzip2 ca-certificates curl tar

  $SUDO mkdir -p "$micromamba_prefix/bin" "$prefix"
  tmp="$(mktemp -d)"
  curl -fsSL "https://micro.mamba.pm/api/micromamba/${mamba_arch}/latest" | tar -xvj -C "$tmp" bin/micromamba
  $SUDO install -m 755 "$tmp/bin/micromamba" "$micromamba_prefix/bin/micromamba"
  rm -rf "$tmp"

  $SUDO chown -R "$(id -u):$(id -g)" "$prefix" "$micromamba_prefix"
  "$micromamba_prefix/bin/micromamba" create -y -p "$prefix" -c conda-forge $conda_packages

  write_exec_wrapper /usr/local/bin/sage "\"$micromamba_prefix/bin/micromamba\" run -p \"$prefix\" sage"

  $SUDO chown -R "$owner_uid:$owner_gid" "$prefix" "$micromamba_prefix"
  $SUDO chmod -R u+rwX,go+rX "$prefix" "$micromamba_prefix"
  $SUDO rm -rf /var/lib/apt/lists/*
}

install_source_sage() {
  local -a clone_args
  local make_jobs
  local sage_bin
  local sage_python
  local sage_python_bin

  log "Installing build dependencies"
  $SUDO apt-get update
  if [ "$install_recommended_apt_packages" = "true" ]; then
    apt_install_available \
      autoconf \
      automake \
      bash \
      bison \
      build-essential \
      ca-certificates \
      cmake \
      curl \
      dpkg-dev \
      file \
      flex \
      g++ \
      gfortran \
      git \
      graphviz \
      libbz2-dev \
      libboost-all-dev \
      libreadline-dev \
      libssl-dev \
      libtool \
      m4 \
      make \
      patch \
      perl \
      pkg-config \
      python3 \
      python3-pip \
      python3-setuptools \
      python3-venv \
      python3-wheel \
      rsync \
      sudo \
      tachyon \
      tar \
      xz-utils \
      zlib1g-dev
  fi

  if [ "$jobs" = "auto" ]; then
    make_jobs="$(nproc 2>/dev/null || echo 2)"
  else
    make_jobs="$jobs"
  fi

  log "Fetching SageMath ${version} from ${source_url}"
  $SUDO rm -rf "$build_dir"
  mkdir -p "$build_dir"
  clone_args=(--branch "$version")
  case "$clone_depth" in
    "" | 0 | full | none) ;;
    *) clone_args+=(--depth "$clone_depth") ;;
  esac
  git clone "${clone_args[@]}" "$source_url" "$build_dir/sage"

  log "Moving source tree into ${prefix}"
  $SUDO rm -rf "$prefix"
  $SUDO mkdir -p "$(dirname "$prefix")"
  $SUDO mv "$build_dir/sage" "$prefix"
  $SUDO chown -R "$(id -u):$(id -g)" "$prefix"

  export SAGE_FAT_BINARY="yes"
  export SAGE_INSTALL_GCC="no"
  export MAKE="make -j${make_jobs}"

  log "Configuring SageMath source build"
  cd "$prefix"
  make configure
  ./configure --enable-build-as-root

  log "Building SageMath with ${make_jobs} jobs"
  make

  sage_bin="$prefix/sage"
  sage_python="$("$sage_bin" -python -c 'import sys; print(sys.executable)')"
  if [ ! -x "$sage_python" ]; then
    echo "Sage Python is not executable: $sage_python" >&2
    exit 1
  fi
  pin_python_venv_link "$sage_python"
  sage_python_bin="$(dirname "$sage_python")"

  log "Installing Jupyter packages into Sage Python"
  "$sage_bin" -python -m pip install --no-cache-dir --upgrade pip setuptools wheel
  "$sage_bin" -python -m pip install --no-cache-dir \
    ipykernel \
    jupyter-console \
    jupyterlab \
    notebook

  log "Installing SageMath entry points"
  write_exec_wrapper /usr/local/bin/sage "\"$sage_bin\""
  write_exec_wrapper /usr/local/bin/sagemath "\"$sage_bin\""
  write_exec_wrapper /usr/local/bin/python "\"$sage_bin\" -python"
  write_exec_wrapper /usr/local/bin/python3 "\"$sage_bin\" -python"
  write_exec_wrapper /usr/local/bin/pip "\"$sage_bin\" -python -m pip"
  write_exec_wrapper /usr/local/bin/pip3 "\"$sage_bin\" -python -m pip"

  for executable in jupyter jupyter-lab jupyter-notebook jupyter-console ipython; do
    link_executable "$sage_python_bin/$executable" "/usr/local/bin/$executable"
  done

  log "Installing Python Jupyter kernel"
  $SUDO "$sage_bin" -python -m ipykernel install --prefix=/usr/local --name python3 --display-name "Python 3 (Sage)"

  log "Installing Sage Jupyter kernel"
  if ! $SUDO "$sage_bin" -python - <<'PY'
from sage.repl.ipython_kernel.install import SageKernelSpec

SageKernelSpec.update(prefix="/usr/local")
PY
  then
    log "Sage kernel installer API failed; trying to copy an existing kernelspec"
    for kernel in "$prefix"/local/var/lib/sage/*/share/jupyter/kernels/sagemath; do
      if [ -d "$kernel" ]; then
        $SUDO rm -rf /usr/local/share/jupyter/kernels/sagemath
        $SUDO mkdir -p /usr/local/share/jupyter/kernels
        $SUDO cp -a "$kernel" /usr/local/share/jupyter/kernels/
        break
      fi
    done
  fi
  if [ ! -f /usr/local/share/jupyter/kernels/sagemath/kernel.json ]; then
    for kernel in "$prefix"/local/var/lib/sage/*/share/jupyter/kernels/sagemath "$HOME"/.local/share/jupyter/kernels/sagemath /root/.local/share/jupyter/kernels/sagemath; do
      if [ -d "$kernel" ]; then
        $SUDO rm -rf /usr/local/share/jupyter/kernels/sagemath
        $SUDO mkdir -p /usr/local/share/jupyter/kernels
        $SUDO cp -a "$kernel" /usr/local/share/jupyter/kernels/
        break
      fi
    done
  fi

  if [ "$install_sagetex" = "true" ]; then
    log "Installing sagetex package"
    "$sage_bin" -p sagetex || log "sagetex install failed; continuing"
  fi

  install_sage_optionals "$sage_bin" "$make_jobs"

  if [ "$preserve_build_artifacts" = "true" ]; then
    log "Preserving full Git history, source archives, caches, and build artifacts"
  else
    log "Cleaning SageMath build artifacts"
    rm -rf \
      "$prefix/.git" \
      "$prefix/src/doc/output/doctrees" \
      "$prefix/upstream"
    find "$prefix" -type d -name __pycache__ -prune -exec rm -rf {} + || true
    find "$prefix/local/lib" "$prefix/local/bin" -type f ! -name '*.a' -exec strip '{}' ';' 2>&1 \
      | grep -v "File format not recognized" \
      | grep -v "File truncated" || true
    find "$prefix/local/lib" -type f -name '*.a' -exec ranlib '{}' ';' 2>/dev/null || true

    if [ "$clean_build_dir" = "true" ]; then
      rm -rf "$build_dir"
    fi
    rm -rf "$HOME/.cache/pip" /tmp/pip-* /tmp/tmp.* || true
    $SUDO rm -rf /root/.cache 2>/dev/null || true
    $SUDO rm -rf /var/lib/apt/lists/*
  fi
  $SUDO chown -R "$owner_uid:$owner_gid" "$prefix"
  $SUDO chmod -R u+rwX,go+rX "$prefix"
  if has_optional_packages; then
    $SUDO chown -R "$owner_uid:$owner_gid" "$(dirname "$optional_manifest")"
    $SUDO chmod -R u+rwX,go+rX "$(dirname "$optional_manifest")"
  fi
}

case "$method" in
  apt)
    install_apt_sage
    ;;
  auto)
    $SUDO apt-get update
    if apt-cache policy sagemath | grep -q 'Candidate: [^(]'; then
      install_apt_sage
    else
      install_source_sage
    fi
    ;;
  micromamba)
    install_micromamba_sage
    ;;
  source)
    install_source_sage
    ;;
  *)
    echo "unknown SageMath install method: $method" >&2
    exit 1
    ;;
esac
