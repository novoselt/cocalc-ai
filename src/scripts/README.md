# CoCalc Scripts

This directory is for repository-level operator and developer scripts.

Keep new scripts in a named subdirectory with a README unless there is a strong
reason for a top-level entry point. Top-level scripts should be actively used,
documented, or referenced from code.

## Top-Level Entry Points

- `build-local-codex-binaries.sh`: build upstream Codex binaries locally or
  for one native Linux architecture.
- `publish-local-codex-binaries.sh`: publish Codex binary assets.
- `check_doc_urls.py` and `check_doc_urls.skip`: documentation/link checker.
- `export-api-doc.ts`: export API documentation JSON.
- `run-ci.sh`: local full clean/build/test helper.

`build-local-codex-binaries.sh` builds both Linux architectures by default.
Set `CODEX_BUILD_PLATFORM=linux-x64` or `linux-arm64` to build only that
architecture natively. The current release intentionally uses unmodified
upstream Codex: remote compaction v2 uses the normal Responses stream and the
legacy compact endpoint also has an upstream request timeout, so the former
CoCalc TCP timeout patch is no longer applied.

## Active Product And Release Workflows

- `star/`: CoCalc Star release build, install, smoke, and public installer
  entry points.
- `star-poc/`: shared Star bootstrap/runtime implementation used by the
  current Star installer. The name is historical; do not delete it as a POC.
- `bay-systemd/`: systemd bay runtime scaffold and upgrade workflow, including
  `upgrade-bay-release.sh`.
- `control-plane-bundle/`: control-plane bundle build helper.

## Active Dev And QA Workflows

- `dev/`: local hub/lite daemons, smoke tests, benchmarks, and personal dev
  helpers.
- `bug-hunt/`: bug-hunting automation and tests.
- `install/`: small dependency installers used by dev/test flows.
- `patches/`: patches consumed by release/build scripts.

## Support Material

- `auth/`: authentication helper scripts.
- `postgresql/`: database maintenance snippets and notes.
- `skel/`: legacy skeleton shell files used as static inputs.
