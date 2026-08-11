#!/usr/bin/env bash

# Seed a disposable RootFS version family for testing /rootfs locally.
#
# Usage:
#   scripts/dev/seed-rootfs-family.sh
#   scripts/dev/seed-rootfs-family.sh clean
#
# PGHOST/PGUSER/PGDATABASE or DATABASE_URL may be supplied explicitly. Missing
# values are discovered from the running hub or from hub-daemon.sh when possible.

set -euo pipefail

action="${1:-seed}"
case "$action" in
  seed | clean) ;;
  *)
    echo "usage: $0 [seed|clean]" >&2
    exit 2
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_root="$(cd "$script_dir/../.." && pwd)"

psql_args=(-v ON_ERROR_STOP=1)
if [[ -n "${DATABASE_URL:-}" ]]; then
  psql_args+=("$DATABASE_URL")
else
  hub_pid="$(
    ps -eo pid=,args= | awk -v hub_root="$source_root/packages/hub/" '
      index($0, hub_root) && $0 ~ /hub\.js/ { print $1; exit }
    '
  )"
  if [[ -n "$hub_pid" && -r "/proc/$hub_pid/environ" ]]; then
    for key in PGHOST PGUSER PGDATABASE; do
      if [[ -z "${!key:-}" ]]; then
        value="$(
          tr '\0' '\n' <"/proc/$hub_pid/environ" |
            sed -n "s/^${key}=//p" |
            head -n 1
        )"
        if [[ -n "$value" ]]; then
          printf -v "$key" '%s' "$value"
          export "$key"
        fi
      fi
    done
  fi
  if [[ -z "${PGHOST:-}" ]]; then
    status="$(bash "$source_root/scripts/dev/hub-daemon.sh" status 2>/dev/null || true)"
    detected_pg_host="$(sed -n 's/^postgres socket (PGHOST): //p' <<<"$status" | head -n 1)"
    if [[ -n "$detected_pg_host" && "$detected_pg_host" != not\ detected* ]]; then
      export PGHOST="$detected_pg_host"
    fi
  fi
  export PGUSER="${PGUSER:-smc}"
  export PGDATABASE="${PGDATABASE:-smc}"
fi

if ! psql "${psql_args[@]}" -Atqc "SELECT 1 FROM rootfs_images LIMIT 1" >/dev/null 2>&1; then
  echo "Unable to connect to the local RootFS catalog database." >&2
  echo "Start the hub, or set DATABASE_URL (or PGHOST, PGUSER, and PGDATABASE)." >&2
  echo "The hub connection is shown by: pnpm dev:hub:status" >&2
  exit 1
fi

server_address="$(
  psql "${psql_args[@]}" -Atqc \
    "SELECT COALESCE(inet_server_addr()::TEXT, 'local-socket')"
)"
case "$server_address" in
  local-socket | 127.* | ::1) ;;
  *)
    echo "Refusing to seed a non-local PostgreSQL server ($server_address)." >&2
    exit 1
    ;;
esac

if [[ "$action" == "clean" ]]; then
  psql "${psql_args[@]}" <<'SQL'
DELETE FROM rootfs_images
WHERE image_id LIKE 'dev-rootfs-family-%'
   OR image_id LIKE 'dev-rootfs-fixture-%';
SQL
  echo "Removed the local RootFS family fixtures."
  exit 0
fi

psql "${psql_args[@]}" <<'SQL'
BEGIN;

DELETE FROM rootfs_images
WHERE image_id LIKE 'dev-rootfs-family-%';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM rootfs_images
    WHERE image_id NOT LIKE 'dev-rootfs-family-%'
      AND image_id NOT LIKE 'dev-rootfs-fixture-%'
      AND COALESCE(hidden, false) = false
      AND COALESCE(blocked, false) = false
      AND COALESCE(deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'No existing visible RootFS image is available to clone';
  END IF;
END
$$;

WITH source AS (
  SELECT *
  FROM rootfs_images
  WHERE image_id NOT LIKE 'dev-rootfs-family-%'
    AND image_id NOT LIKE 'dev-rootfs-fixture-%'
    AND COALESCE(hidden, false) = false
    AND COALESCE(blocked, false) = false
    AND COALESCE(deleted, false) = false
  ORDER BY COALESCE(official, false) DESC, updated DESC NULLS LAST
  LIMIT 1
), fixtures(
  image_id, slug, label, family, version, supersedes_image_id, age,
  description, tags, icon, color, accent_color, gpu
) AS (
  VALUES
    (
      'dev-rootfs-fixture-basic-1-5', 'dev-cocalc-basic-1-5', 'CoCalc Basic',
      'ubuntu', '1.5', NULL, INTERVAL '210 days',
      'Basic Python, Pip, apt-get, LaTeX, Jupyter, and a scientific stack.',
      ARRAY['standard', 'teaching', 'jupyter', 'latex', 'python'],
      'cocalc-ring', '#0d47a1', '#d9d9d9', false
    ),
    (
      'dev-rootfs-fixture-basic-1-6', 'dev-cocalc-basic-1-6', 'CoCalc Basic',
      'ubuntu', '1.6', 'dev-rootfs-fixture-basic-1-5', INTERVAL '120 days',
      'Basic Python, Pip, apt-get, LaTeX, Jupyter, and a scientific stack.',
      ARRAY['standard', 'teaching', 'jupyter', 'latex', 'python'],
      'cocalc-ring', '#0d47a1', '#d9d9d9', false
    ),
    (
      'dev-rootfs-fixture-basic-1-7', 'dev-cocalc-basic-1-7', 'CoCalc Basic',
      'ubuntu', '1.7', 'dev-rootfs-fixture-basic-1-6', INTERVAL '8 days',
      'Basic Python, Pip, apt-get, LaTeX, Jupyter, and a scientific stack.',
      ARRAY['standard', 'teaching', 'jupyter', 'latex', 'python'],
      'cocalc-ring', '#0d47a1', '#d9d9d9', false
    ),
    (
      'dev-rootfs-fixture-sage-10-9', 'dev-sagemath-10-9', 'SageMath',
      'sagemath', '10.9', NULL, INTERVAL '160 days',
      'SageMath with Python and a ready-to-use Jupyter kernel.',
      ARRAY['teaching', 'python', 'sagemath', 'jupyter', 'math'],
      'sagemath-bold', '#0288d1', '#e1f5fe', false
    ),
    (
      'dev-rootfs-fixture-sage-10-9-p1', 'dev-sagemath-10-9-p1', 'SageMath',
      'sagemath', '10.9.p1', 'dev-rootfs-fixture-sage-10-9', INTERVAL '35 days',
      'SageMath with Python and a ready-to-use Jupyter kernel.',
      ARRAY['teaching', 'python', 'sagemath', 'jupyter', 'math'],
      'sagemath-bold', '#0288d1', '#e1f5fe', false
    ),
    (
      'dev-rootfs-fixture-r-p1', 'dev-r-rstudio-p1', 'R, RStudio, Jupyter',
      'r', '4.5.2.p1', NULL, INTERVAL '100 days',
      'R, RStudio, and Jupyter with the tidyverse and data-science packages.',
      ARRAY['r', 'teaching', 'statistics', 'jupyter', 'data-science'],
      'r', '#276dc3', '#e8f1fb', false
    ),
    (
      'dev-rootfs-fixture-r-p2', 'dev-r-rstudio-p2', 'R, RStudio, Jupyter',
      'r', '4.5.2.p2', 'dev-rootfs-fixture-r-p1', INTERVAL '7 days',
      'R, RStudio, and Jupyter with the tidyverse and data-science packages.',
      ARRAY['r', 'teaching', 'statistics', 'jupyter', 'data-science'],
      'r', '#276dc3', '#e8f1fb', false
    ),
    (
      'dev-rootfs-fixture-legacy-06', 'dev-cocalc-legacy-2026-06',
      'CoCalc Legacy: Jupyter, Julia, R, Sage, LaTeX', 'cocalc-legacy',
      '2026.06', NULL, INTERVAL '150 days',
      'The comprehensive CoCalc compatibility image for established projects.',
      ARRAY['cocalc', 'migration', 'sagemath', 'latex', 'python', 'jupyter', 'julia', 'r', 'rstudio', 'code-server', 'math', 'statistics', 'vscode', 'ide', 'legacy'],
      'cube', '#1b4f8a', '#e7f0fa', false
    ),
    (
      'dev-rootfs-fixture-legacy-08', 'dev-cocalc-legacy-2026-08',
      'CoCalc Legacy: Jupyter, Julia, R, Sage, LaTeX', 'cocalc-legacy',
      '2026.08', 'dev-rootfs-fixture-legacy-06', INTERVAL '6 days',
      'The comprehensive CoCalc compatibility image for established projects.',
      ARRAY['cocalc', 'migration', 'sagemath', 'latex', 'python', 'jupyter', 'julia', 'r', 'rstudio', 'code-server', 'math', 'statistics', 'vscode', 'ide', 'legacy'],
      'cube', '#1b4f8a', '#e7f0fa', false
    ),
    (
      'dev-rootfs-fixture-texlive-07', 'dev-texlive-2026-07', 'TeX Live 2026',
      'texlive', '2026.07', NULL, INTERVAL '80 days',
      'Complete TeX Live with PythonTeX, Quarto, and R Markdown.',
      ARRAY['latex', 'texlive', 'pythontex', 'rmarkdown', 'quarto', 'knitr'],
      'tex-file', '#00838f', '#e0f7fa', false
    ),
    (
      'dev-rootfs-fixture-texlive-08', 'dev-texlive-2026-08', 'TeX Live 2026',
      'texlive', '2026.08', 'dev-rootfs-fixture-texlive-07', INTERVAL '5 days',
      'Complete TeX Live with PythonTeX, Quarto, and R Markdown.',
      ARRAY['latex', 'texlive', 'pythontex', 'rmarkdown', 'quarto', 'knitr'],
      'tex-file', '#00838f', '#e0f7fa', false
    ),
    (
      'dev-rootfs-fixture-octave', 'dev-octave-11-3', 'Octave',
      'octave', '11.3', NULL, INTERVAL '4 days',
      'GNU Octave with numerical packages and Jupyter kernels.',
      ARRAY['octave', 'math', 'numerical', 'jupyter', 'python'],
      'octave', '#0790c0', '#e0f6fc', false
    ),
    (
      'dev-rootfs-fixture-webdev', 'dev-web-development-1-0', 'Web Development',
      'webdev', '1.0', NULL, INTERVAL '14 days',
      'Node.js, Bun, Deno, code-server, Jupyter, PostgreSQL, and Redis.',
      ARRAY['code-server', 'jupyter', 'nodejs', 'bun', 'deno', 'python', 'web'],
      'code', '#9c27b0', '#f3e5f5', false
    ),
    (
      'dev-rootfs-fixture-julia', 'dev-julia-1-12', 'Julia',
      'julia', '1.12.6', NULL, INTERVAL '18 days',
      'Julia with Pluto, Jupyter, and VS Code.',
      ARRAY['julia', 'jupyter', 'code-server', 'pluto', 'vscode'],
      'code', '#4063d8', '#eef0ff', false
    ),
    (
      'dev-rootfs-fixture-latex', 'dev-latex-1-0', 'LaTeX',
      'latex', '1.0', NULL, INTERVAL '60 days',
      'A full LaTeX installation for technical document authoring.',
      ARRAY['latex', 'documents', 'texlive'],
      'tex-file', '#00838f', '#e0f7fa', false
    ),
    (
      'dev-rootfs-fixture-cambridge', 'dev-cambridge-1-0',
      'Cambridge University Press', 'cambridge', '1.0', NULL, INTERVAL '28 days',
      'Python, Jupyter, R, and LaTeX for publication workflows.',
      ARRAY['cambridge', 'publishing', 'python', 'jupyter', 'r', 'latex'],
      'book', '#c62828', '#ffebee', false
    ),
    (
      'dev-rootfs-fixture-pytorch', 'dev-pytorch-2-11', 'PyTorch',
      'pytorch', '2.11.0', NULL, INTERVAL '12 days',
      'PyTorch with CUDA GPU support, Jupyter, Python, and LaTeX.',
      ARRAY['python', 'jupyter', 'pytorch', 'cuda', 'nvidia-gpu', 'gpu', 'machine-learning'],
      'cube', '#e64a19', '#fbe9e7', true
    )
)
INSERT INTO rootfs_images (
  image_id,
  release_id,
  slug,
  owner_id,
  runtime_image,
  created,
  updated,
  label,
  family,
  version,
  channel,
  supersedes_image_id,
  description,
  default_jupyter_kernel,
  visibility,
  official,
  prepull,
  hidden,
  blocked,
  deleted,
  arch,
  gpu,
  size_gb,
  tags,
  digest,
  content_key,
  deprecated,
  theme,
  content,
  content_warnings
)
SELECT
  fixtures.image_id,
  source.release_id,
  fixtures.slug,
  NULL,
  source.runtime_image,
  NOW() - fixtures.age,
  NOW() - fixtures.age,
  fixtures.label,
  fixtures.family,
  fixtures.version,
  'stable',
  fixtures.supersedes_image_id,
  fixtures.description,
  source.default_jupyter_kernel,
  'public',
  true,
  false,
  false,
  false,
  false,
  COALESCE(source.arch, 'any'),
  fixtures.gpu,
  source.size_gb,
  array_append(fixtures.tags, 'dev-fixture'),
  source.digest,
  source.content_key,
  false,
  COALESCE(source.theme, '{}'::JSONB) || jsonb_build_object(
    'title', fixtures.label,
    'description', fixtures.description,
    'icon', fixtures.icon,
    'color', fixtures.color,
    'accent_color', fixtures.accent_color
  ),
  source.content,
  source.content_warnings
FROM source
CROSS JOIN fixtures
ON CONFLICT (image_id) DO UPDATE SET
  release_id = EXCLUDED.release_id,
  slug = EXCLUDED.slug,
  owner_id = EXCLUDED.owner_id,
  runtime_image = EXCLUDED.runtime_image,
  created = EXCLUDED.created,
  updated = EXCLUDED.updated,
  label = EXCLUDED.label,
  family = EXCLUDED.family,
  version = EXCLUDED.version,
  channel = EXCLUDED.channel,
  supersedes_image_id = EXCLUDED.supersedes_image_id,
  description = EXCLUDED.description,
  default_jupyter_kernel = EXCLUDED.default_jupyter_kernel,
  visibility = EXCLUDED.visibility,
  official = EXCLUDED.official,
  prepull = EXCLUDED.prepull,
  hidden = EXCLUDED.hidden,
  blocked = EXCLUDED.blocked,
  deleted = EXCLUDED.deleted,
  arch = EXCLUDED.arch,
  gpu = EXCLUDED.gpu,
  size_gb = EXCLUDED.size_gb,
  tags = EXCLUDED.tags,
  digest = EXCLUDED.digest,
  content_key = EXCLUDED.content_key,
  deprecated = EXCLUDED.deprecated,
  theme = EXCLUDED.theme,
  content = EXCLUDED.content,
  content_warnings = EXCLUDED.content_warnings;

COMMIT;
SQL

echo "Seeded 17 RootFS fixtures modeled on the public CoCalc catalog."
echo "Reload http://localhost:9100/rootfs to preview them."
echo "Clean up with: scripts/dev/seed-rootfs-family.sh clean"
