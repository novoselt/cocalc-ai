# CoCalc CLI Windows SEA Port Plan

Status: deferred; feasibility confirmed, implementation not started.

## Outcome

Ship the CoCalc CLI as a native, signed Windows x64 single-executable
application with the same core user capabilities as the Linux and macOS
binaries.  Use the work to establish reusable SEA build, packaging, and
release-signing machinery that can also be adopted by Sage.js.

There is no architectural blocker.  The API, WebSocket, authentication, file,
and browser-client core is Node.js and portable.  The bounded Windows work is
at operating-system boundaries: SEA construction, local IPC, command/tool
discovery, helper-process dispatch, installation, signing, and a few commands
that intentionally orchestrate Unix systems.

## Scope

Initial supported target:

- Windows 11 and supported Windows Server releases;
- native Windows x64, without requiring WSL, MSYS2, Git Bash, or MinGW;
- a self-contained `cocalc.exe` built with the pinned Node.js 26 SEA builder;
- core auth, API, project, file, browser, SSH, sync, and daemon workflows;
- clear capability errors for optional external programs;
- PowerShell installation, upgrades, and uninstall instructions;
- Authenticode signing and verification in CI.

Windows arm64 can follow after x64 is reliable.  Porting every local
Linux-administration or development command is not required for the first
release.  Commands that build Linux root filesystems or depend intrinsically
on local Linux facilities should be explicitly capability-gated.

## Design Principles

- Do not make Windows support depend on a Unix compatibility layer.
- Keep the main CLI path JavaScript/TypeScript-only and SEA-friendly.
- Build and test each platform on its native CI runner.
- Keep signing downstream of reproducible unsigned artifact construction.
- Make optional external dependencies discoverable and report actionable
  installation instructions.
- Prefer self-reexecution through hidden internal CLI modes over launching
  loose JavaScript files with `process.execPath`.
- Keep product-specific packaging thin; share generic SEA and signing logic
  with Sage.js.

## Phase 1: Modernize SEA Construction

Replace `packages/cli/sea/build-sea.sh` and the postject/fuse workflow with a
cross-platform Node.js build program.

The builder should:

1. Resolve and verify the pinned Node.js 26 builder.
2. Build the NCC bundle.
3. Generate a platform-specific SEA configuration.
4. Run `node --build-sea <config>` directly.
5. Produce `cocalc.exe` on Windows and the existing native names elsewhere.
6. Run relocation and basic invocation smoke tests.
7. Produce archives, SHA-256 checksums, and publication metadata.

Retain Node 24 compatibility for ordinary monorepo development if desired;
the release artifact may use its separately pinned Node 26 runtime.  Remove
the runtime dependency on `postject`, fuse discovery with `strings`, `uname`,
and symlink construction from the platform-neutral build path.

Acceptance checks:

- `cocalc.exe --version` and `cocalc.exe --help` work on a clean Windows VM.
- The executable still works after relocation to a different directory.
- Linux and macOS artifacts pass their existing smoke tests after migration.
- The built artifact does not require an external Node.js installation.

## Phase 2: Make SEA Helper Processes Self-Contained

Audit every use of `process.execPath`.  In an SEA it names the CoCalc
executable, not a general-purpose Node interpreter.

Introduce private dispatch modes such as:

```text
cocalc __internal cli-daemon ...
cocalc __internal browser-daemon ...
cocalc __internal reflect-sync ...
```

Use self-reexecution and internal dispatch for:

- the CLI daemon;
- the Playwright browser-session daemon;
- reflect-sync forwarding;
- any future worker that must survive after its initiating command exits.

Do not rely on loose `dist/*.js` files being present beside the SEA.  Keep the
internal commands absent from ordinary help output and test their argument and
shutdown contracts directly.

Acceptance checks:

- Browser session spawning works from an isolated SEA installation.
- Reflect-sync forwarding works without an external Node executable or source
  tree.
- Daemon start, ping, restart after upgrade, and shutdown work from the SEA.
- Helper failures cannot accidentally recurse into the public CLI command.

## Phase 3: Windows Runtime Portability Layer

### Local IPC

Use a per-user Windows named pipe, for example
`\\.\pipe\cocalc-cli-<stable-user-token>`, instead of a filesystem Unix socket.
Continue using Node's `net` API.  Skip Unix socket unlinking and chmod on
Windows, while preserving PID/log state in an appropriate per-user data
directory.

Test concurrent clients, stale PID recovery, daemon upgrades, and isolation
between Windows users.

### Paths and private state

- Define native config/data/cache directory helpers rather than scattering
  XDG assumptions.
- Preserve explicit `COCALC_*` path overrides on every platform.
- Use `%APPDATA%` or `%LOCALAPPDATA%` defaults on Windows.
- Treat Unix permission modes as best-effort metadata on Windows; do not use
  chmod success as a security assertion there.
- Test spaces, Unicode, long paths, and non-ASCII Windows usernames.

### External command discovery

Replace `bash -lc 'command -v ...'` with a platform-neutral PATH resolver or a
direct spawn probe.  Handle `PATHEXT` and `.exe` correctly.

Support or detect:

- Windows OpenSSH (`ssh.exe` and `ssh-keygen.exe`);
- `cloudflared-windows-amd64.exe`, including automatic download and checksum
  verification;
- Chrome and Edge in standard per-user and system installation locations;
- optional `rsync`, with an explicit unsupported/capability message when it is
  absent.

Do not require Git for Windows merely to obtain shell utilities.

### Processes and signals

Exercise detached children, Ctrl-C, timeouts, termination, and forced shutdown
on Windows.  Avoid depending on Unix signal distinctions where Windows gives
Node only process-termination semantics.

## Phase 4: Command Capability Audit

Classify every top-level command as one of:

1. fully portable and tested on Windows;
2. portable when an optional documented executable is installed;
3. a remote Linux operation whose local client remains portable;
4. intentionally unavailable on native Windows.

The first release should prioritize ordinary users:

- authentication and profiles;
- project lifecycle and project file operations;
- terminal/exec and SSH connectivity;
- browser session discovery and automation;
- project sync/forwarding;
- machine-readable output and scripting behavior.

Local rootfs construction, host-image assembly, rocket development workflows,
and similar operator tooling may remain Linux-only.  Reject them early with a
precise explanation rather than failing later because `bash`, `tar`, `sudo`,
or a Linux artifact is missing.

## Phase 5: Windows Packaging and Installation

Add a PowerShell installer rather than translating the shell installer line by
line.  It should:

- fetch the signed release manifest over HTTPS;
- select Windows x64;
- verify SHA-256 before installation;
- install versioned binaries under a per-user directory;
- update a stable `cocalc.exe` command atomically;
- update the user PATH with explicit consent and idempotent behavior;
- support upgrades, rollback to the previous binary, and uninstall;
- avoid requiring administrator privileges.

Publish a zip and the raw signed executable.  Later, consider WinGet and a thin
npm installer/dispatcher.  The npm-facing package must not inherit the current
monorepo package's `only-allow pnpm` preinstall restriction.

Correct `packages/cli/package.json` repository/homepage metadata to the actual
`sagemathinc/cocalc-ai` repository before enabling npm provenance or trusted
publishing.

## Phase 6: CI, Signing, and Publication

Add focused CLI jobs instead of requiring the entire CoCalc service stack to
become Windows-native.

Unsigned build/test jobs:

- use Blacksmith runners where available and beneficial;
- build the CLI package and SEA on native Windows x64;
- run unit tests for portability helpers;
- run `--help`, `--version`, relocation, mock-API, named-pipe daemon, and
  installer smoke tests;
- upload immutable unsigned artifacts.

Signing/release jobs:

- use a protected GitHub `release` environment;
- authenticate to Azure Trusted Signing with GitHub OIDC;
- sign and timestamp `cocalc.exe` without exporting a long-lived signing key;
- verify the Authenticode chain and timestamp after signing;
- publish only verified signed artifacts and checksums;
- test installation from the published candidate manifest before promoting
  `latest`.

Keep pull-request builds unsigned.  Release signing should operate only on the
artifact produced and hashed by the build job.

## Shared Sage.js Release Tooling

Factor only genuinely product-neutral behavior into shared tooling:

- Node version resolution/download and checksum verification;
- SEA configuration and `--build-sea` invocation;
- platform/architecture naming;
- archives, checksums, manifests, and relocation smoke tests;
- Apple signing/notarization and Azure signing action wrappers;
- signature verification and release promotion primitives.

Keep these product-specific:

- CoCalc internal helper dispatch and R2 publication layout;
- Sage.js FLINT/native assets and Jupyter-kernel resources;
- product names, package topology, installer UX, and release manifests.

Start by implementing the reusable JavaScript builder in CoCalc, the
higher-priority consumer.  Apply it immediately to Sage.js and extract the
stable common surface into a small versioned package or a SHA-pinned composite
action once both consumers prove the interface.  Keep thin workflows in each
repository because GitHub environments, npm trusted-publisher identities, and
release permissions are repository-specific.

Organization-level Apple credentials may be authorized for both repositories.
The same Azure Trusted Signing account/profile may also be shared, with a
separate OIDC federated subject for each repository's protected release
workflow.

## Validation Matrix

Before calling the Windows port complete, test at least:

- clean Windows user with no Node.js installed;
- installation path and username containing spaces and Unicode;
- no OpenSSH installed, followed by OpenSSH installation;
- automatic cloudflared installation and direct mode;
- interactive login plus noninteractive API-key/cookie profiles;
- named-pipe daemon lifecycle and concurrent RPC requests;
- project file get/put/list/search operations against a test project;
- browser discovery/spawn against installed Chrome or Edge;
- reflect-sync setup and teardown;
- Ctrl-C and timeout behavior;
- upgrade from one signed version to another and rollback;
- damaged download, checksum mismatch, invalid signature, and stale manifest;
- execution under standard antivirus/SmartScreen conditions.

## Completion Criteria

- A signed native Windows x64 `cocalc.exe` is produced entirely by CI.
- A non-administrator can install and update it with PowerShell.
- Core user workflows pass on a clean Windows machine without WSL or Node.js.
- Unsupported operator/developer commands fail intentionally and clearly.
- Linux and macOS release behavior has not regressed.
- Shared SEA/signing code has a documented integration path for Sage.js.
