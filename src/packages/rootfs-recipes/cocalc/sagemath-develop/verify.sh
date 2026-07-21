set -euo pipefail

prefix="${PREFIX:-/opt/sage}"
expected_ref="${VERSION:-develop}"
owner_uid="${OWNER_UID:-2001}"
owner_gid="${OWNER_GID:-2001}"
jobs="${JOBS:-auto}"
incremental_build_max_seconds="${INCREMENTAL_BUILD_MAX_SECONDS:-1800}"
source_file="$prefix/src/sage/rings/integer.pyx"
probe_name="_cocalc_rootfs_incremental_build_probe"
probe_value="cocalc-sagemath-develop-incremental-build-ok"
git_sage=(git -C "$prefix")
verify_home=""

as_owner() {
  if [ "$(id -u)" = "$owner_uid" ]; then
    if [ -n "$verify_home" ]; then
      env HOME="$verify_home" "$@"
    else
      "$@"
    fi
  elif [ -n "$verify_home" ]; then
    sudo -u "#$owner_uid" -- env HOME="$verify_home" "$@"
  else
    sudo -H -u "#$owner_uid" -- "$@"
  fi
}

as_owner_make() {
  local log_path="$1"
  as_owner bash -c \
    'exec /usr/bin/make -C "$1" -j"$2" >"$3" 2>&1' \
    bash "$prefix" "$make_jobs" "$log_path"
}

if [ "$jobs" = "auto" ]; then
  make_jobs="$(nproc 2>/dev/null || echo 2)"
else
  make_jobs="$jobs"
fi

command -v sage
command -v python
command -v pip
command -v jupyter
test "$(command -v sage)" = /usr/local/bin/sage
test -x "$prefix/sage"
test -d "$prefix/.git"
test -d "$prefix/upstream"
test -f "$source_file"
test "$(stat -c %u "$prefix")" = "$owner_uid"
test "$(stat -c %g "$prefix")" = "$owner_gid"
as_owner test -w "$prefix"

test "$(as_owner "${git_sage[@]}" rev-parse --is-shallow-repository)" = false
test "$(as_owner "${git_sage[@]}" branch --show-current)" = "$expected_ref"
test "$(as_owner "${git_sage[@]}" rev-parse HEAD)" = \
  "$(as_owner "${git_sage[@]}" rev-parse "refs/remotes/origin/$expected_ref")"
as_owner "${git_sage[@]}" remote get-url origin
as_owner "${git_sage[@]}" log -1 --format='SageMath commit: %H %cI %s'

verify_home="$(as_owner mktemp -d)"
cleanup_verify_home() {
  as_owner rm -rf "$verify_home"
}
trap cleanup_verify_home EXIT

as_owner sage --version
as_owner sage -c 'from sage.all import ZZ; assert ZZ(2) + ZZ(2) == 4'
as_owner python - <<'PY'
import sys
from sage.all import ZZ

assert ZZ(19).is_prime()
assert sys.executable.startswith("/opt/sage/"), sys.executable
print(sys.executable)
PY
as_owner pip --version | grep -F "$prefix/"
as_owner jupyter kernelspec list
as_owner jupyter kernelspec list 2>/dev/null | grep -qi sagemath
as_owner jupyter kernelspec list 2>/dev/null | grep -q python3
as_owner python - <<'PY'
import json
import shutil
from pathlib import Path

kernel = json.loads(
    Path("/usr/local/share/jupyter/kernels/sagemath/kernel.json").read_text()
)
assert kernel["language"].lower() == "sage", kernel
assert kernel["argv"][1:3] == ["-m", "sage.repl.ipython_kernel"], kernel
assert shutil.which(kernel["argv"][0]), kernel
PY

backup="$(as_owner mktemp)"
incremental_log="$(as_owner mktemp)"
restore_log="$(as_owner mktemp)"
as_owner cp "$source_file" "$backup"
restored=false

restore_source() {
  if [ "$restored" = true ]; then
    return
  fi
  echo "Restoring $source_file and rebuilding the original Sage module"
  as_owner cp "$backup" "$source_file"
  as_owner touch "$source_file"
  if ! as_owner_make "$restore_log"; then
    as_owner tail -n 200 "$restore_log" >&2 || true
    return 1
  fi
  restored=true
}

cleanup() {
  restore_source
  as_owner rm -rf "$backup" "$incremental_log" "$restore_log" "$verify_home"
}
trap cleanup EXIT

as_owner tee -a "$source_file" >/dev/null <<PYX

def $probe_name():
    return "$probe_value"
PYX

echo "Running incremental SageMath build after changing sage.rings.integer"
start_seconds="$SECONDS"
if ! as_owner_make "$incremental_log"; then
  as_owner tail -n 200 "$incremental_log" >&2 || true
  exit 1
fi
incremental_seconds="$((SECONDS - start_seconds))"
echo "Incremental SageMath build completed in ${incremental_seconds} seconds"
if [ "$incremental_seconds" -gt "$incremental_build_max_seconds" ]; then
  echo "Incremental build exceeded ${incremental_build_max_seconds} seconds" >&2
  exit 1
fi

as_owner "$prefix/sage" -c \
  "from sage.rings.integer import $probe_name; assert $probe_name() == '$probe_value'; print($probe_name())"

restore_source
if as_owner "$prefix/sage" -c "from sage.rings.integer import $probe_name" >/dev/null 2>&1; then
  echo "Incremental build probe remained importable after restoring the source" >&2
  exit 1
fi

test -z "$(as_owner "${git_sage[@]}" status --porcelain --untracked-files=no)"
trap - EXIT
as_owner rm -rf "$backup" "$incremental_log" "$restore_log" "$verify_home"
