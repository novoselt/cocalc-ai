set -euo pipefail

prefix="${PREFIX:-/opt/sage}"
expected_ref="${VERSION:-develop}"
owner_uid="${OWNER_UID:-2001}"
owner_gid="${OWNER_GID:-2001}"
owner_home="${OWNER_HOME:-${COCALC_RUNTIME_HOME:-/home/user}}"
jobs="${JOBS:-auto}"
python_change_max_seconds="${PYTHON_CHANGE_MAX_SECONDS:-60}"
incremental_build_max_seconds="${INCREMENTAL_BUILD_MAX_SECONDS:-1800}"
python_source="$prefix/src/sage/all.py"
cython_source="$prefix/src/sage/rings/integer.pyx"
python_probe_value="cocalc-sagemath-develop-python-source-ok"
python_command_value="cocalc-sagemath-develop-python-command-ok"
cython_probe_name="_cocalc_rootfs_incremental_build_probe"
cython_probe_value="cocalc-sagemath-develop-incremental-build-ok"
git_sage=(git -C "$prefix")

as_owner() {
  if [ "$(id -u)" = "$owner_uid" ]; then
    env HOME="$owner_home" "$@"
  else
    sudo -u "#$owner_uid" -- env HOME="$owner_home" "$@"
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

for executable in \
  sage python pip jupyter \
  ccache gdb git-lfs htop jq less lsof nano rg strace tmux tree unzip vim zip; do
  command -v "$executable"
done
test "$(command -v sage)" = /usr/local/bin/sage
test -x "$prefix/sage"
test -d "$prefix/.git"
test -d "$prefix/build/sage-distro"
test -d "$prefix/upstream"
test -f "$python_source"
test -f "$cython_source"
test "$(stat -c %u "$prefix")" = "$owner_uid"
test "$(stat -c %g "$prefix")" = "$owner_gid"
as_owner test -w "$prefix"
for runtime_dir in .sage .ipython .jupyter .local/share/jupyter; do
  test "$(stat -c %u "$owner_home/$runtime_dir")" = "$owner_uid"
  test "$(stat -c %g "$owner_home/$runtime_dir")" = "$owner_gid"
  as_owner test -w "$owner_home/$runtime_dir"
done

test "$(as_owner "${git_sage[@]}" rev-parse --is-shallow-repository)" = false
test "$(as_owner "${git_sage[@]}" branch --show-current)" = "$expected_ref"
test "$(as_owner "${git_sage[@]}" rev-parse HEAD)" = \
  "$(as_owner "${git_sage[@]}" rev-parse "refs/remotes/origin/$expected_ref")"
as_owner "${git_sage[@]}" remote get-url origin
as_owner "${git_sage[@]}" log -1 --format='SageMath commit: %H %cI %s'

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

python_backup="$(as_owner mktemp)"
cython_backup="$(as_owner mktemp)"
incremental_log="$(as_owner mktemp)"
restore_log="$(as_owner mktemp)"
as_owner cp "$python_source" "$python_backup"
as_owner cp "$cython_source" "$cython_backup"
python_modified=false
cython_modified=false

restore_python_source() {
  if [ "$python_modified" = false ]; then
    return
  fi
  echo "Restoring $python_source"
  as_owner cp "$python_backup" "$python_source"
  python_modified=false
}

restore_cython_source() {
  if [ "$cython_modified" = false ]; then
    return
  fi
  echo "Restoring $cython_source and rebuilding the original Sage module"
  as_owner cp "$cython_backup" "$cython_source"
  as_owner touch "$cython_source"
  if ! as_owner_make "$restore_log"; then
    as_owner tail -n 200 "$restore_log" >&2 || true
    return 1
  fi
  cython_modified=false
}

cleanup() {
  restore_python_source || true
  restore_cython_source || true
  as_owner rm -f \
    "$python_backup" "$cython_backup" "$incremental_log" "$restore_log" || true
}
trap cleanup EXIT

as_owner tee -a "$python_source" >/dev/null <<PY

print("$python_probe_value")
PY
python_modified=true

echo "Running SageMath after changing sage.all"
start_seconds="$SECONDS"
python_output="$(
  as_owner "$prefix/sage" -c "print('$python_command_value')"
)"
python_seconds="$((SECONDS - start_seconds))"
printf '%s\n' "$python_output"
echo "Modified Python source loaded in ${python_seconds} seconds"
grep -qFx "$python_probe_value" <<<"$python_output"
grep -qFx "$python_command_value" <<<"$python_output"
if [ "$python_seconds" -gt "$python_change_max_seconds" ]; then
  echo "Loading modified Python source exceeded ${python_change_max_seconds} seconds" >&2
  exit 1
fi

restore_python_source
if grep -qF "$python_probe_value" "$python_source"; then
  echo "Python source probe remained after restoring $python_source" >&2
  exit 1
fi

as_owner tee -a "$cython_source" >/dev/null <<PYX

def $cython_probe_name():
    return "$cython_probe_value"
PYX
cython_modified=true

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
  "from sage.rings.integer import $cython_probe_name; assert $cython_probe_name() == '$cython_probe_value'; print($cython_probe_name())"

restore_cython_source
if as_owner "$prefix/sage" -c "from sage.rings.integer import $cython_probe_name" >/dev/null 2>&1; then
  echo "Incremental build probe remained importable after restoring the source" >&2
  exit 1
fi

test -z "$(as_owner "${git_sage[@]}" status --porcelain --untracked-files=no)"
test -z "$(find "$prefix" -xdev ! -uid "$owner_uid" -print -quit)"
for runtime_dir in .sage .ipython .jupyter .local/share/jupyter; do
  test -z "$(find "$owner_home/$runtime_dir" -xdev ! -uid "$owner_uid" -print -quit)"
done
trap - EXIT
as_owner rm -f \
  "$python_backup" "$cython_backup" "$incremental_log" "$restore_log"
