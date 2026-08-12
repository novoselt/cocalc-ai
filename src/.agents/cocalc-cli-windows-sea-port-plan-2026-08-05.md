# CoCalc CLI and Plus Native Windows Port

Status: native Windows x64 CLI is implemented and manually integration-tested;
native Windows CoCalc Plus is an advanced preview. Neither should yet be
described as battle-tested or generally available.

Last updated: 2026-08-12.

## Executive Summary

The original feasibility assessment was correct: there was no architectural
blocker to a native Windows CoCalc CLI. The core port is now implemented rather
than deferred. A standalone Node.js 26 SEA `cocalc.exe` builds and runs on
Windows without Node.js, WSL, MSYS2, Git Bash, or MinGW. On a dedicated Windows
x64 VM it has successfully authenticated to `lite4b.cocalc.ai`, listed projects,
and passed `project file check`, including real project file operations through
the per-user named-pipe daemon.

The release pipeline now describes one immutable four-platform CLI release:

- Linux x86_64;
- Linux aarch64;
- macOS arm64, Developer ID signed and optionally notarized;
- Windows x86_64, Authenticode signed through Microsoft Artifact Signing.

It builds one portable NCC bundle, constructs each SEA on a native runner,
verifies artifact identity and architecture, tests installers, and publishes
only after every required platform succeeds. The Windows signing path uses
GitHub OIDC and does not put a Microsoft private signing key in GitHub.

CoCalc Plus has also progressed from a feasibility idea to a native Windows
preview. It starts the Lite/Plus Express application directly on Windows, uses
PowerShell through ConPTY for terminals, maps canonical CoCalc paths to a native
workspace, has a PowerShell installer with rollback/uninstall, and has a native
Blacksmith Windows packaging/smoke workflow. A terminal works in manual browser
testing. File editing exposed additional path and SQLite-directory portability
bugs; those fixes now pass a native collaborative-editor persistence smoke
test. Plus remains less mature than the CLI and still needs manual feature
testing.

## Current Scope

Initial supported CLI target:

- Windows 11 and supported Windows Server releases;
- native Windows x64;
- self-contained `cocalc.exe` built with official Node.js 26 SEA support;
- auth, profiles, hub/project control-plane operations, project file APIs,
  OpenSSH integration, cloudflared installation, and the CLI daemon;
- per-user PowerShell installation without administrator privileges;
- versioned upgrades, rollback, uninstall, checksum verification, and optional
  PATH updates;
- Microsoft Artifact Signing/Public Trust in protected release CI.

Still intentionally out of initial scope:

- Windows arm64;
- Linux-only host/rootfs/image/operator workflows;
- local Playwright browser spawning from the standalone SEA. This is a known
  standalone-SEA development limitation, not a requirement for normal project
  enumeration, files, SSH, or other core CLI use;
- claiming command-by-command parity before a full capability audit;
- declaring general availability before signed CI releases and broader manual
  testing have run successfully.

## Implemented CLI Work

### Cross-platform SEA construction

The old shell/postject/fuse construction path has been replaced by
`packages/cli/sea/build-sea.mjs`. It:

1. requires an official SEA-enabled Node.js 26 runtime;
2. consumes the shared NCC bundle from `build-bundle.mjs`;
3. invokes `node --build-sea` on the native target runner;
4. creates the platform-specific artifact name, including `.exe` on Windows;
5. applies macOS signing when configured;
6. packages the Linux runtime dependency;
7. verifies release identity, architecture, relocation/native execution, and
   required signatures;
8. creates a stable local development alias/copy.

The same JavaScript bundle is used for all targets, but native executable
construction and execution happen on the target OS and CPU. That avoids
emulated or mislabeled artifacts such as the previously published x86_64 Linux
binary that was actually built for another architecture.

### Runtime portability

The following Windows boundaries are implemented:

- config under `%APPDATA%\CoCalc`;
- data/cache under `%LOCALAPPDATA%\CoCalc\CLI`;
- explicit `COCALC_*` overrides remain supported;
- Unix chmod is skipped where it has no Windows security meaning;
- executable discovery understands Windows PATH, `PATHEXT`, and `.exe`;
- Windows OpenSSH can be discovered and invoked directly;
- the native Windows cloudflared binary can be downloaded and used;
- process timeout/termination no longer assumes Unix signal distinctions;
- CLI daemon state uses the per-user application-data tree;
- daemon IPC uses a stable per-user `\\.\pipe\cocalc-cli-...` named pipe;
- the SEA re-executes itself correctly to start its internal daemon rather than
  treating `process.execPath` as a general Node interpreter.

The named-pipe user token is derived from Windows user identity data. More
multi-user and hostile-local-user testing is still warranted before treating
the daemon transport as fully hardened.

### Windows installation

`packages/cli/install.ps1` now provides a native per-user installer. It:

- downloads the Windows amd64 channel manifest and executable;
- verifies SHA-256;
- requires valid Authenticode for stable/latest;
- rejects invalid signatures on channels where a signature is present;
- installs immutable versions under `%LOCALAPPDATA%\CoCalc\CLI\versions`;
- switches a stable `cocalc.cmd` launcher;
- stops the prior daemon while changing versions;
- supports rollback and uninstall;
- modifies user PATH only with explicit consent.

The installer smoke test covers installation, native `--version`, invalid
release IDs, checksum mismatch rejection, upgrade, rollback, signature-policy
behavior, and uninstall.

### Native release CI

`.github/workflows/release-cocalc-cli.yml` now has native jobs for:

- Linux amd64 on Blacksmith Ubuntu;
- Linux arm64 on Blacksmith Ubuntu arm64;
- macOS arm64 on Blacksmith macOS;
- Windows amd64 on Blacksmith Windows.

The macOS job imports an ephemeral Developer ID certificate, signs the SEA,
submits it to Apple notarization when requested, and verifies the result. The
Windows job uses GitHub OIDC to authenticate to Azure, signs and timestamps the
PE file with Microsoft Artifact Signing, verifies Authenticode, and runs the
PowerShell installer smoke test. The publish job requires all four artifacts,
re-verifies their metadata, uploads an immutable release, promotes the selected
channel, and smoke-tests the published software metadata. Stable/latest cannot
be published with Windows signing disabled.

The workflow implementation is substantial, but the complete signed workflow
still needs to be run with real credentials. Code and configuration are not a
substitute for observing successful signing, notarization, publication, and
installation from a public candidate channel.

## Evidence So Far

Confirmed manually on the dedicated native Windows x64 VM:

- standalone `cocalc.exe --version` and `--help` execute;
- interactive browser-approved login to `https://lite4b.cocalc.ai` succeeds;
- authenticated profile status succeeds;
- project enumeration succeeds;
- `project file check --project <id>` succeeds, exercising actual temporary
  project file operations and cleanup;
- the CLI daemon works through native Windows named-pipe IPC;
- no WSL or external Node.js runtime is needed by the SEA executable.

Confirmed by focused automated tests/builds during implementation:

- platform path selection;
- command discovery and Windows `PATHEXT` behavior;
- daemon path/named-pipe transport primitives;
- artifact/platform verification;
- software artifact selection and release metadata;
- native SEA invocation and relocation/version checks in the builder;
- PowerShell installer negative and lifecycle tests;
- existing CLI package build/tests used while developing the port.

Not yet established:

- sustained use by a diverse population of Windows users;
- behavior under common endpoint security/antivirus products and SmartScreen;
- a successful production-quality Microsoft Public Trust signing run;
- a successful full four-platform signed candidate workflow using all final
  GitHub environment credentials;
- exhaustive testing of spaces, Unicode, long paths, non-ASCII usernames,
  concurrent daemon clients, stale state, interruption, and upgrades between
  genuinely different releases;
- every top-level CLI command on Windows.

## Cross-platform Regression Risk

There is nonzero, nontrivial regression risk because the work changed shared
SEA construction, release publication, command discovery, process termination,
daemon startup, and platform path helpers. Those are important code paths on
Linux and macOS.

The risk is bounded for several reasons:

- Windows-specific directories, named pipes, chmod behavior, `.exe` lookup,
  and process branches are gated on `process.platform === "win32"` or an
  explicitly supplied platform in unit tests;
- Linux/macOS defaults remain XDG/POSIX based;
- the shared command lookup implementation is simpler and avoids shell
  interpolation, but it does change behavior from `bash -lc command -v` and is
  therefore a meaningful compatibility surface;
- the shared SEA builder is deliberately exercised natively on every target;
- publication cannot proceed until Linux amd64, Linux arm64, macOS arm64, and
  Windows amd64 build and verify under one release ID;
- Linux installation is tested in clean Ubuntu 24.04 and 26.04 containers;
- macOS Developer ID verification/notarization and Windows Authenticode
  verification are explicit release gates.

Current assessment: accidental Linux/macOS breakage is unlikely, but not
impossible. Confidence should come from running the complete candidate workflow
and manually installing/testing that candidate on Linux and macOS, not merely
from code review. A candidate release should precede any stable promotion.

## GitHub Credentials and Protection

Create protected environments under **GitHub repository Settings ->
Environments**, with required reviewers:

### `cocalc-cli-signing`

Apple secrets:

- `APPLE_DEVELOPER_ID_P12_BASE64`
- `APPLE_DEVELOPER_ID_P12_PASSWORD`
- `APPLE_NOTARY_KEY_P8_BASE64`
- `APPLE_NOTARY_KEY_ID`
- `APPLE_NOTARY_ISSUER_ID`

Azure/Microsoft Artifact Signing secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_ARTIFACT_SIGNING_ENDPOINT`
- `AZURE_ARTIFACT_SIGNING_ACCOUNT`
- `AZURE_ARTIFACT_SIGNING_PROFILE`

Use a Microsoft Artifact Signing **Public Trust** certificate profile. Grant
the OIDC application's service principal the **Artifact Signing Certificate
Profile Signer** role and configure this federated subject:

```text
repo:sagemathinc/cocalc-ai:environment:cocalc-cli-signing
```

Issuer and audience:

```text
issuer:   https://token.actions.githubusercontent.com
audience: api://AzureADTokenExchange
```

No Azure client secret and no Microsoft code-signing private key belong in
GitHub.

### `cocalc-cli-release`

R2 publication secrets only:

- `COCALC_R2_ACCOUNT_ID`
- `COCALC_R2_ACCESS_KEY_ID`
- `COCALC_R2_SECRET_ACCESS_KEY`
- `COCALC_R2_BUCKET`
- `COCALC_R2_PUBLIC_BASE_URL`

## CoCalc Plus Native Windows Preview

CoCalc Plus is substantially harder than the CLI because it includes Lite,
project/backend filesystem services, Conat persistence, collaborative editors,
and PTY-backed terminals. It is nonetheless now running natively on Windows.

Implemented:

- native Lite/Plus Express server, no WSL;
- bundled Node.js 26 runtime and Windows-targeted native addons;
- workspace at `%USERPROFILE%\CoCalc` by default;
- application data at `%LOCALAPPDATA%\CoCalc\Plus`;
- PowerShell/ConPTY terminal support;
- canonical `/home/user/...` protocol paths mapped to native workspace paths;
- project listing/read/write/realpath/rename/move support;
- PowerShell ZIP installer with versioned installs, rollback, and uninstall;
- Blacksmith Linux bundle plus native Windows packaging workflow;
- runtime smoke coverage for HTTP startup, default project-files landing,
  local auth bootstrap, project files, collaborative editor persistence, and a
  real PowerShell terminal.

Observed manually:

- Plus starts and loads in a Windows browser;
- the project terminal works through PowerShell/ConPTY;
- the original `/settings` landing page was confusing; the root route now
  targets the fallback project's file explorer and the runtime smoke verifies
  that redirect;
- opening a file exposed native-path leakage into POSIX Patchflow identifiers
  and missing parent-directory creation for Windows SQLite persistence. These
  are real portability defects, not cosmetic warnings. The fixes pass a clean
  native Windows installer/runtime smoke that opens, changes, and saves a
  collaborative document through the same synchronization stack.

Remaining Plus work before a credible preview release:

- repeat the Windows collaborative editor smoke in CI and across releases;
- manually open/edit/save several file types in the browser;
- verify SQLite-backed account/project streams across restart;
- test spaces and Unicode in workspace and profile paths;
- exercise Jupyter and other project features deliberately rather than
  assuming that a working terminal implies full backend portability;
- add signing and a release/promotion policy for the Plus ZIP/runtime;
- run on a clean Windows VM without development tooling;
- improve lifecycle UX around browser launch, daemon status, logs, upgrades,
  and recovery.

An Electron shell remains a sensible later product direction, but it should be
layered on a reliable native Windows Plus server. Electron would not fix path,
SQLite, sync, PTY, or backend portability bugs underneath it.

## Remaining CLI Work

Priority order:

1. Configure the two protected GitHub environments and Blacksmith access.
2. Run `Release CoCalc CLI` with channel `none` and real Apple/Microsoft
   credentials; retain and inspect every artifact and signing/notary log.
3. Run it again to publish a `candidate` channel.
4. Install that exact candidate on clean Windows, macOS arm64, Linux amd64, and
   Linux arm64 systems; run auth, project list, project file check, SSH, daemon
   lifecycle, upgrade, and rollback tests.
5. Finish the top-level command capability audit and add early actionable
   Windows errors for intrinsically Linux-only commands.
6. Add Windows stress tests for named-pipe concurrency, stale PID recovery,
   Ctrl-C, timeout/termination, spaces, Unicode, long paths, and antivirus.
7. Promote to stable only after candidate soak time and review.
8. Consider Windows arm64 once x64 is reliable.

## Validation Matrix Before General Availability

- clean Windows user with no Node.js installed;
- installation path and username containing spaces and Unicode;
- no OpenSSH installed, then OpenSSH installed;
- cloudflared installation and direct mode;
- interactive login and noninteractive auth profiles;
- named-pipe daemon lifecycle, concurrent RPC, stale state, and upgrade;
- project file check plus larger get/put/list/search operations;
- SSH and sync/forwarding where supported;
- Ctrl-C and timeout behavior;
- upgrade between two distinct signed versions and rollback;
- damaged download, checksum mismatch, invalid signature, and stale manifest;
- SmartScreen and representative endpoint protection;
- Linux amd64, Linux arm64, and macOS arm64 regression installs from the same
  candidate release.

## Revised Completion Criteria

The implementation milestone is achieved: a useful native Windows x64 CLI
exists and has completed real integration work against a development CoCalc
deployment.

The production milestone is not yet achieved. It requires:

- successful CI-produced, signed, timestamped native Windows x64 artifacts;
- successful signed/notarized macOS and verified Linux artifacts from the same
  release workflow;
- per-user installation and update from a published candidate manifest;
- core workflow validation on clean native systems without WSL or Node.js;
- intentional errors for unsupported operator/developer commands;
- candidate soak time with no material Linux/macOS regressions;
- documentation that accurately distinguishes supported, optional, and
  unsupported commands.

This is already far better than no Windows support, but it should still be
presented as a high-value alpha/candidate until the remaining release and field
testing is complete.
