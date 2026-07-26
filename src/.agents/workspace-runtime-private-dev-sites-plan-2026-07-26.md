# Workspace Runtime and Private Development Sites Plan

Date: 2026-07-26

Status: detailed implementation plan for a developer prototype

## Executive decision

Build a trusted **workspace runtime** for CoCalc Launchpad that runs logical
CoCalc projects as ordinary processes and directories inside an existing CoCalc
project. Pair it with authenticated, random, private hostnames for project apps.

This is intended to let a developer run one or more complete CoCalc development
sites from source checkouts inside an ordinary `cocalc.ai` project, without:

- Podman inside the developer project,
- a dedicated GCP project,
- GCP or Nebius credentials,
- Cloudflare credentials,
- a Cloudflare tunnel,
- a public application endpoint,
- or a production-like project-host fleet.

The first users are the three existing personal development environments:

- William's `lite1b` replacement,
- William's `lite2b` replacement,
- Blaec's development environment.

The prototype is not the later "one click for anybody" product. It should,
however, establish an architecture and command surface that can become that
product instead of creating a disposable special case.

## Recommendation

Proceed with this before rebuilding the personal development GCP environments.
The codebase already contains most of the necessary seams:

- the project runner RPC accepts injected lifecycle callbacks,
- directory-backed project storage already exists through
  `COCALC_PROJECT_PATH`,
- the project daemon already runs as a normal foreground process,
- Launchpad already provides a compact multi-user control plane,
- project apps already supervise and proxy long-running HTTP/WebSocket
  services,
- project hosts already support browser-session bootstrap using scoped bearer
  tokens,
- and project hosts already authorize HTTP and WebSocket requests against the
  outer project's collaborator list.

The missing work is concentrated in:

1. a non-Podman project-runner backend,
2. explicit runtime capabilities,
3. Launchpad startup/configuration for that backend,
4. private hostname reservation and routing,
5. a source-checkout-oriented developer command,
6. tests and migration tooling.

## Scope

The prototype must support:

- one developer running several independent CoCalc sites concurrently;
- one source checkout or Git worktree per site;
- a separate PGlite database and runtime directory per site;
- multiple logical projects inside each site;
- project start, stop, status, and restart;
- files, terminals, Jupyter, Codex/ACP, chat, collaboration, and ordinary
  frontend work;
- landing-page and static frontend builds;
- HTTP and WebSocket access at a dedicated hostname;
- access restricted to collaborators on the outer `cocalc.ai` project;
- persistent logs and inspectable runtime metadata;
- restart recovery after the inner Launchpad process exits;
- removal without leaving uncontrolled child processes;
- explicit diagnostics showing that workspace isolation is not a security
  boundary.

## Non-goals

The prototype will not support:

- public or anonymous access;
- a public-access toggle;
- Cloudflare tunnels;
- per-inner-project Unix users;
- Podman or nested containers;
- rootfs selection or mutation fidelity;
- cgroup CPU, memory, PID, or IO isolation;
- per-project disk quotas;
- GCP, Nebius, or other cloud-host provisioning;
- real project-host placement or migration;
- production backup, restore, move, or snapshot fidelity;
- Dropbear or project-host SSH fidelity;
- GPU testing;
- untrusted users inside the inner site;
- production credentials, production data, or production database snapshots;
- polished self-service onboarding for arbitrary CoCalc users.

Staging remains the place to test production-like project hosts, networking,
deployment, resource enforcement, backup, and provider integration.

## Terminology

### Outer project

The ordinary production `cocalc.ai` project owned by the developer. Production
project-host isolation protects this project from other CoCalc customers.

### Development site

One complete inner CoCalc site consisting of:

- one source checkout or Git worktree,
- one Launchpad control-plane process,
- one PGlite database,
- one workspace project runner,
- zero or more inner project processes,
- one private project-app registration,
- one private random hostname.

### Inner project

A logical project created inside the development site. Its home directory is a
subdirectory of the development site's workspace project root. It is not an
independent security sandbox.

### Workspace runtime

The project-runner backend that starts `cocalc-project` directly as the current
Unix user instead of creating a Podman container.

### Private development hostname

A random hostname such as:

```text
dev-a1b2c3d4e5.cocalc.ai
```

It routes to a registered app in the outer project and always requires a valid
outer-project collaborator session. Randomness prevents naming collisions; it
is not the authorization mechanism.

## Target topology

```text
Developer browser
    |
    | authenticated cocalc.ai session
    v
cocalc.ai hub
    |
    | short-lived project-host bearer
    v
dev-a1b2c3d4e5.cocalc.ai
    |
    | Cloudflare proxied CNAME; no tunnel
    v
Outer project's existing project host
    |
    | collaborator authorization and private hostname rewrite
    v
Outer project app proxy
    |
    v
Launchpad process in source checkout
    |
    | local Conat project-runner RPC
    v
Workspace runtime
    |
    +-- projects/<project-id-1>/ + cocalc-project process
    +-- projects/<project-id-2>/ + cocalc-project process
    +-- projects/<project-id-3>/ + cocalc-project process
```

The hub authorizes and provides routing metadata. Steady-state browser traffic
flows directly to the outer project's project host, consistent with
`scalable-architecture.md`.

## Current repository facts

### Project runner seam

`packages/conat/project/runner/run.ts` already accepts injected callbacks for:

- `start`,
- `stop`,
- `status`,
- `save`,
- `move`,
- `localPath`,
- `sshServers`.

This is already a backend interface in practice, though it is not named or
packaged as one.

`packages/project-runner/run/index.ts` currently hard-wires those callbacks to
the Podman implementation and runs Podman-specific stale cleanup. The backend
selection should be introduced there rather than adding workspace-mode checks
throughout project control code.

### Directory-backed storage

`packages/project-runner/run/filesystem.ts` already maps a project to:

```text
${COCALC_PROJECT_PATH}/${project_id}
```

when `COCALC_PROJECT_PATH` is set and file-server RPC is not forced. This is the
desired home-directory layout. The implementation creates the directory when
needed.

### Direct project process

`packages/project/project.ts` starts the project daemon after validating
`HOME` and `DATA`. `packages/project/init-program.ts` supports foreground
startup, random ports, an explicit bind hostname, and optional SSH.

Workspace mode should run it:

- in the foreground from the runner's perspective,
- bound to `127.0.0.1`,
- without `--daemon`,
- without `--sshd`,
- without runtime user-drop bootstrap,
- and with `COCALC_PROJECT_INFO_SCOPE=owned`.

The last setting is important. Without it, process diagnostics could expose
unrelated processes owned by the same outer-project Unix user.

### Launchpad gate

`packages/server/conat/index.ts` currently starts embedded project-runner
services for non-Launchpad products and deliberately skips them for Launchpad.
Workspace mode should replace this product-name test with explicit runtime
configuration:

| Mode        | Launchpad behavior                                        |
| ----------- | --------------------------------------------------------- |
| `external`  | Current default; do not start an embedded runner          |
| `workspace` | Start one embedded workspace runner and its load balancer |
| `podman`    | Not enabled inside ordinary CoCalc projects               |

The default must remain `external` so existing Launchpad installations do not
silently change behavior.

### Local project lifecycle path

Projects with no `host_id` already use the legacy local project-runner client
through `packages/server/projects/control/base.ts`. The local runner load
balancer is marked deprecated, but it remains the shortest valid path for this
prototype.

The implementation should first add an integration test proving that a
Launchpad workspace project with `host_id IS NULL` reaches the embedded runner.
If current placement logic automatically requires a host, workspace mode should
add one explicit local-runtime branch rather than creating a fake cloud
project-host row.

### Existing private HTTP authorization

Project hosts already provide:

- a browser-session bootstrap endpoint at
  `/.cocalc/project-host/session`,
- short-lived host-scoped bearer verification,
- an HttpOnly browser-session cookie,
- collaborator authorization for HTTP requests,
- collaborator authorization for WebSocket upgrades,
- revocation checks,
- outer-project autostart only when an authenticated account is present.

The private hostname feature must reuse this machinery.

### Existing hostname work

`packages/server/app-public-subdomains.ts` and the project-host hostname rewrite
contain useful routing and DNS concepts, but public app exposure is currently
disabled deliberately.

The private feature must not re-enable public exposure or overload
`project_app_public_subdomains` with different security semantics. Public and
private hostname policies should remain distinct in code and storage.

## Security model

### Outer boundary

The outer production project-host and its Podman runtime remain the real
customer isolation boundary. The outer project has no production operator,
Cloudflare, GCP, Nebius, Stripe, or staging credentials.

### Inner boundary

Inner projects are organization only. All inner projects:

- run as the same Unix UID,
- can inspect the same process namespace available to that UID,
- can read sibling directories unless ordinary filesystem permissions happen
  to prevent it,
- can bind local ports,
- can consume shared outer-project resources,
- can signal processes owned by the same UID,
- and can potentially interfere with the inner Launchpad process.

Therefore every inner account must be trusted equivalently to an outer-project
collaborator. The site must present a persistent admin warning:

> Workspace projects are not isolated containers. Every user of this
> development site can potentially access all files and processes in the
> enclosing CoCalc project.

### Required invariants

1. Workspace mode is off by default.
2. It cannot be enabled in `cocalc.ai` production hubs or project-host
   processes accidentally; it is a property of the inner Launchpad process.
3. No workspace project receives production credentials.
4. No private hostname request bypasses outer-project collaborator
   authorization.
5. Random hostname labels are identifiers, not bearer secrets.
6. Direct navigation without a valid project-host browser session fails
   closed.
7. Anonymous requests cannot start the outer project or inner development site.
8. Public app exposure remains disabled and separate.
9. The inner signup policy defaults to closed or invite/admin-only.
10. Email defaults to disabled or sink-only.
11. Stripe defaults to absent or test mode with application-level provisioning
    disabled.
12. Cloud provider configuration is absent in ordinary workspace sites.
13. Inner project resource controls are labeled unsupported rather than
    pretending to enforce quotas.
14. Route deletion and collaborator removal revoke future access.
15. WebSocket authorization receives the same treatment as HTTP.

## Runtime configuration

Introduce one canonical parser, preferably under
`packages/server/launchpad/project-runtime.ts` or
`packages/project-runner/runtime-mode.ts`.

Suggested environment:

```text
COCALC_PROJECT_RUNTIME=external|workspace|podman
COCALC_PROJECT_PATH=/absolute/path/to/site-data/projects
COCALC_WORKSPACE_RUNTIME_STATE=/absolute/path/to/site-data/runtime
COCALC_WORKSPACE_RUNTIME_LOGS=/absolute/path/to/site-data/logs/projects
COCALC_WORKSPACE_RUNTIME_PROJECT_BIN=/absolute/path/to/cocalc-project
```

Rules:

- Launchpad defaults to `external`.
- The development command explicitly sets `workspace`.
- Non-Launchpad source development retains current Podman behavior unless
  configured otherwise.
- Unknown values fail startup with an actionable error.
- Relative paths are rejected.
- The project path and runtime state path must not be the source checkout.
- Runtime logs and PGlite data should be ignored by Git.

## Project-runner backend design

### Interface

Promote the existing callback collection into a named internal interface:

```ts
interface ProjectRuntimeBackend {
  readonly name: "podman" | "workspace";
  init(): Promise<void>;
  start(options: StartOptions): Promise<ProjectStatus>;
  stop(options: StopOptions): Promise<void>;
  status(options: StatusOptions): Promise<ProjectStatus>;
  save(options: SaveOptions): Promise<void>;
  close?(): Promise<void>;
}
```

Do not move all Podman code as part of the first commit. Add a small adapter
around the existing exports, then implement the workspace adapter separately.

### Workspace state layout

Use:

```text
site-data/
  pglite/
  projects/
    <project-id>/
      .local/share/cocalc/
      ...
  runtime/
    projects/
      <project-id>.json
    site.json
  logs/
    launchpad.stdout.log
    launchpad.stderr.log
    projects/
      <project-id>.stdout.log
      <project-id>.stderr.log
```

Each runtime record should contain:

- schema version,
- project ID,
- PID,
- Linux process start ticks when available,
- spawn timestamp,
- executable path,
- home path,
- data path,
- hub port,
- browser port,
- current source commit if available,
- runner instance ID,
- last observed state,
- last error.

PID alone is insufficient because PIDs are reused.

### Start

The start algorithm should:

1. Serialize concurrent starts for one project using the existing in-flight
   reuse plus a backend-local lock.
2. Resolve and create the project home through `localPath`.
3. Check for a valid existing runtime record.
4. Adopt a matching healthy process rather than starting a duplicate.
5. Remove stale runtime metadata only after process identity validation.
6. Ensure standard shell files and project data paths using existing runner
   utilities.
7. Allocate random loopback ports or pass zero and read the selected ports from
   project information.
8. Build a minimal allowlisted environment.
9. Spawn `cocalc-project` without a shell.
10. Redirect stdout and stderr to persistent project-specific logs.
11. Wait for both project information and a health check.
12. Persist runtime metadata atomically.
13. Return the same status shape expected by the existing runner RPC.
14. Terminate the child and report a concise startup error if readiness times
    out.

### Environment

The child environment should be constructed explicitly instead of copying the
entire Launchpad environment.

Required values include:

```text
HOME=<site-data>/projects/<project-id>
DATA=<HOME>/.local/share/cocalc
SMC=<same as DATA, if still required>
COCALC_PROJECT_ID=<project-id>
COCALC_USERNAME=<current Unix user>
COCALC_PROJECT_INFO_SCOPE=owned
CONAT_SERVER=<inner Launchpad's local Conat address>
PATH=<source/toolchain path>
NODE_PATH=<source/build module path when required>
```

Explicitly remove or override:

- outer `COCALC_PROJECT_ID`,
- outer project secret and bearer variables,
- outer project-host `CONAT_SERVER`,
- `COCALC_AGENT_TOKEN`,
- browser automation tokens,
- Cloudflare credentials,
- GCP credentials,
- Stripe credentials,
- email provider credentials,
- production database variables,
- runtime bootstrap/user-drop flags,
- Podman-specific networking values.

The Launchpad startup code already scrubs an inherited outer `CONAT_SERVER`.
The workspace child must then receive the newly initialized inner Conat
address, not the outer project-host address.

### Stop

The stop algorithm should:

1. Validate the runtime record against `/proc` before signaling.
2. Send `SIGTERM`.
3. Wait for a bounded graceful interval.
4. Send `SIGKILL` only if necessary.
5. Kill the validated project process group, not an unverified PID.
6. Remove runtime metadata atomically after confirmed exit.
7. Leave the project home intact.
8. Return `opened` when the process is already gone.

### Recovery

On workspace-runner startup:

- scan runtime records;
- validate PID, process start ticks, executable, and project ID;
- adopt healthy matching processes;
- remove records for dead processes;
- terminate only positively identified unhealthy workspace project processes;
- never signal an ambiguous PID;
- republish adopted status to runner state;
- record recovery actions in logs.

When the outer project stops, the outer project-host container boundary should
terminate every process. Recovery still matters for inner Launchpad restarts
while the outer project remains running.

### Save, move, SSH, and quota behavior

For the prototype:

- `save({home:true})` is a documented no-op because home is already a normal
  directory in the outer project.
- rootfs save is unsupported and returns an explicit capability error.
- move is unsupported.
- project-host SSH is unsupported.
- disk, memory, CPU, PID, and IO limits are not enforced per inner project.
- scratch is a directory only if needed; it is not an isolated volume.

Do not silently claim successful enforcement.

## Runtime capabilities

Add a structured capability object rather than scattering product-name tests.
At minimum:

```ts
interface ProjectRuntimeCapabilities {
  isolation: "container" | "workspace";
  rootfs: boolean;
  snapshots: boolean;
  move: boolean;
  backups: boolean;
  ssh: boolean;
  gpu: boolean;
  resource_limits: boolean;
  cloud_hosts: boolean;
}
```

Workspace values are false except for ordinary project lifecycle and local
filesystem persistence.

The capabilities should be available to:

- backend validation,
- project settings UI,
- host/compute UI,
- admin diagnostics,
- CLI status,
- automated tests.

The initial UI may hide unsupported controls, but backend calls must also reject
them.

## Private development hostname design

### Decision

Use one Cloudflare-proxied DNS CNAME per registered private development app for
the prototype. Do not use Cloudflare tunnels and do not share a `cloudflared`
process.

Example:

```text
dev-a1b2c3d4e5.cocalc.ai CNAME <outer-project-hostname>
```

Advantages:

- direct data-plane traffic to the existing project host;
- no new edge proxy service;
- no tunnel lifecycle or multiplexing instability;
- existing project-host TLS and routing model;
- simple deletion and reconciliation;
- only three initial developers and a small number of parallel sites.

The 3,500-record Pro-plan limit is not relevant to the prototype. If this later
becomes a broad product, evaluate wildcard-per-host namespaces, a dedicated
authenticated edge router, or a Cloudflare plan upgrade based on measured
usage. Do not complicate the prototype for that future scale.

Use a one-level hostname under `cocalc.ai` initially so existing wildcard TLS
coverage can apply. A nested name such as `x.dev.cocalc.ai` may require
additional certificate coverage and should not be assumed to work merely
because DNS resolves.

### Separate private data model

Create a private route table, for example:

```sql
CREATE TABLE project_app_private_hostnames (
  project_id UUID NOT NULL,
  app_id TEXT NOT NULL,
  label TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  base_path TEXT NOT NULL,
  dns_record_id TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, app_id)
)
```

For the prototype, one hostname per `(outer project, app ID)` is sufficient.
Multiple app IDs allow several independent CoCalc sites in one outer project.

Do not add:

- `public`,
- `anonymous`,
- `auth_front=none`,
- expiry-to-public behavior,
- or a public fallback.

Route records live in the outer project's owning bay. Cleanup on project hard
delete must follow the same authority rules as other project-owned records.

### Reservation

The reservation API must:

1. Require an authenticated project collaborator with owner or administrator
   authority appropriate for app management.
2. Confirm that the app exists and is private.
3. Generate at least 40 bits of random label entropy.
4. Use a fixed `dev-` prefix.
5. Reject caller-selected production-looking names.
6. Resolve the outer project's current project-host public hostname.
7. Create or update a proxied CNAME.
8. Persist the Cloudflare record ID.
9. return the hostname and URL.
10. Be idempotent for the same project and app.

Neither the outer project nor the inner site receives the Cloudflare token.
Only the production control plane performs DNS changes.

### Browser authorization flow

Opening a private hostname should use:

1. The main frontend confirms that the account can access the outer project.
2. The frontend obtains the existing short-lived bearer scoped to the outer
   project host.
3. The frontend sends an authenticated cross-origin POST to:

   ```text
   https://dev-a1b2c3d4e5.cocalc.ai/.cocalc/project-host/session
   ```

4. The project host verifies the bearer and sets its existing HttpOnly
   browser-session cookie for that exact hostname.
5. The frontend navigates to the private hostname.
6. The project host resolves the hostname to `(outer project, app, base path)`.
7. The normal HTTP or WebSocket authorizer verifies the browser session and
   current collaborator access.
8. Only after authorization does the project host rewrite to the app route and
   proxy to the outer project's local app.

The hostname rewrite must not set the existing public-app marker or invoke the
public-app authorization bypass. Introduce an explicit private-hostname request
context if the proxy needs to preserve the original `Host` header.

### Direct navigation

A request with no valid project-host browser session must not reach the app.
For the prototype it may return a branded `401` page containing:

```text
This private development site must be opened from its CoCalc project.
```

A later version may redirect to a main-site authorization endpoint and return
after login. That redirect flow is not required for William and Blaec to use
the prototype safely.

### Revocation

- Removing a collaborator must prevent new HTTP requests after the existing
  short authorization cache interval.
- Existing WebSockets must be covered by the current revocation sweep.
- Deleting the private hostname must remove both the route row and DNS record.
- Deleting the app must release its private hostname.
- Hard-deleting the outer project must release all private hostnames.
- Moving the outer project to another host must reconcile the CNAME target.
- A failed DNS deletion must remain visible as retryable cleanup state.

### Cloudflare failure behavior

- DNS creation failure does not make the app public.
- An existing route continues working during a temporary Cloudflare API
  outage.
- Runtime start and local path access remain available through the ordinary
  authenticated project app URL.
- The private hostname feature is optional and must not block project startup.

## Developer prototype UX

### Site layout

A developer may create several Git worktrees:

```text
~/cocalc-dev/
  main/
    repo/
    data/
  feature-a/
    repo/
    data/
  feature-b/
    repo/
    data/
```

Each `data` directory has independent PGlite, projects, runtime state, and logs.

### Commands

Add a repository-local command before designing a public CLI:

```text
pnpm -C src dev:workspace:init --name feature-a
pnpm -C src dev:workspace:start --name feature-a
pnpm -C src dev:workspace:status --name feature-a
pnpm -C src dev:workspace:logs --name feature-a
pnpm -C src dev:workspace:stop --name feature-a
pnpm -C src dev:workspace:env --name feature-a
```

The command should:

- allocate and persist a base port;
- set a unique data directory;
- set workspace runtime mode and paths;
- build only missing required packages;
- start Launchpad under the existing project app supervisor when available;
- create or update the private app spec;
- reserve a private hostname on explicit request;
- print both the ordinary private app URL and private hostname;
- never require Cloudflare or cloud-provider credentials in the outer project.

The first implementation may use one checked-in script under
`src/scripts/dev`. It should reuse the daemon conventions already established
by `hub-daemon.sh` and `lite-daemon.sh` rather than creating an unrelated
supervisor format.

### Parallel sites

Parallelism requires:

- separate names,
- separate PGlite directories,
- separate project directories,
- separate runtime-state directories,
- separate log directories,
- separate port ranges,
- separate app IDs,
- separate private hostnames.

The command must detect accidental directory or port reuse and fail before
starting either site.

### Build and refresh loop

For the prototype:

- source edits happen in the selected checkout/worktree;
- frontend/static changes use the existing development build commands;
- backend changes restart the selected Launchpad app;
- inner project daemon changes may require stopping inner projects before
  restart;
- the status command reports the checkout commit and whether generated build
  output is older than source.

Hot-module replacement is desirable but not a release gate. A reliable
build-and-restart loop is sufficient for the first migration.

## Implementation phases

### Phase 0: executable architecture spike

Goal: prove the local lifecycle path before broad refactoring.

Work:

1. Add a focused integration harness that starts one Launchpad instance with
   workspace mode and temporary PGlite data.
2. Create one inner project with no `host_id`.
3. Verify the start request reaches an injected test runner.
4. Run one real `cocalc-project` process against a temporary home.
5. Confirm files, terminal, and project status work.
6. Stop it and verify no child process remains.

Exit gate:

- the lifecycle path is proven in automation;
- any placement assumptions are documented;
- no production code defaults change.

Result (2026-07-26):

- The placement assumption required one explicit correction. Current
  `BaseProject.start()` always assigns a project host, and
  `BaseProject.stop()` treats a missing `host_id` as already stopped. Only
  runner-backed state inspection remained. Explicit Launchpad workspace mode
  now routes start and stop through the existing local runner RPC without
  creating a fake host row.
- A PGlite integration harness creates a real hostless project row under
  Launchpad workspace configuration and verifies that start reaches an
  injected runner while `host_id` remains `NULL`.
- A separate real-process integration harness starts `cocalc-project` as the
  current Unix user with a temporary home and an allowlisted environment. It
  verifies `owned` project diagnostics, Conat file write/read, terminal
  execution, and process-group shutdown.
- The old `hub-server.port` and `browser-server.port` files are no longer a
  useful readiness contract for this path. The current project daemon exposes
  its compute services over Conat, while the project app proxy uses its
  explicitly assigned loopback port. Phase 1 should use Conat readiness plus
  an HTTP proxy health check.
- `COCALC_PROJECT_RUNTIME` remains `external` by default for Launchpad and
  `podman` by default elsewhere. Workspace mode fails closed outside Launchpad.
- Embedded workspace runner startup, durable process records, adoption, logs,
  and unsupported-operation handling remain Phase 1 work.

Expected effort: 0.5 to 1.5 focused engineering days.

### Phase 1: backend abstraction and workspace lifecycle

Likely files:

- `packages/project-runner/run/index.ts`
- `packages/project-runner/run/workspace.ts`
- `packages/project-runner/run/runtime-backend.ts`
- `packages/project-runner/run/workspace.test.ts`
- `packages/server/conat/index.ts`
- `packages/server/launchpad/project-runtime.ts`
- `packages/launchpad/lib/onprem-config.js`
- corresponding tests

Work:

1. Add strict runtime-mode parsing.
2. Wrap current Podman functions in the backend interface.
3. Implement workspace start, stop, status, recovery, and logs.
4. Wire Launchpad workspace mode to one embedded runner and load balancer.
5. Add child environment allowlisting.
6. Set process diagnostics to `owned`.
7. Add explicit unsupported-operation errors.
8. Add startup and recovery diagnostics.

Exit gate:

- two inner projects can run concurrently;
- stop affects only its target project;
- restart adopts or safely cleans old processes;
- Podman runner tests remain unchanged and passing;
- Launchpad default remains external.

Result (2026-07-26):

- Runtime-mode parsing now has one canonical implementation in
  `@cocalc/project-runner/runtime-mode`. Launchpad remains `external` by
  default, explicit workspace mode is Launchpad-only, invalid values fail
  startup, and nested Podman is rejected.
- The project runner now selects a named backend. The existing Podman exports
  are wrapped without changing their behavior and are loaded lazily, so a
  workspace Launchpad does not load the Podman implementation.
- The Linux workspace backend starts detached `cocalc-project` process groups,
  writes append-only per-project stdout/stderr logs, and records runtime
  identity atomically. Records include PID, process group, `/proc` start ticks,
  a project-specific `argv0`, executable, command, project ID, home, data
  directory, ports, runner instance, and last state. The `argv0` contract lets
  a restarted supervisor identify an orphan safely even when Linux Yama blocks
  the new parent from reading the orphan's `/proc/<pid>/environ` and
  `/proc/<pid>/exe`.
- Start, status, stop, and recovery validate the complete process identity
  before trusting or signaling a PID. Dead records are removed; ambiguous
  records are removed without signaling; healthy children are adopted after
  an inner Launchpad restart; positively identified unhealthy children are
  terminated before relaunch.
- Child environments are built from an allowlist, point explicitly at the
  inner Conat server, force project diagnostics to `owned`, and discard
  credential-shaped configured variables. Workspace state, logs, and project
  directories must be absolute and outside the source checkout.
- Explicit Launchpad workspace mode starts exactly one embedded runner and its
  load balancer on the primary worker. New projects remain hostless. Recovered
  project ports and state are republished into runner state before RPC service.
- Workspace rootfs save and move fail explicitly, home save is a no-op, SSH
  reports unavailable, and resource/image options are logged as unenforced
  rather than silently claiming container semantics.
- The real-process integration test runs two inner projects concurrently,
  constructs a second backend that adopts both, stops one without disturbing
  the other, and verifies persistent logs. A stale-PID test proves that an
  identity mismatch is cleaned without signaling the unrelated process. A
  separate orphan test exercises recovery identity checks under actual
  Yama-restricted `/proc` behavior.
- Focused Podman, runner load-balancer, Launchpad configuration, hostless
  creation, PGlite lifecycle, and package typechecks pass.

Expected effort: 2 to 4 focused engineering days after Phase 0.

### Phase 2: capabilities and UI correctness

Likely areas:

- shared project/runtime types,
- server project control,
- frontend project settings,
- host/compute controls,
- CLI status.

Work:

1. Define runtime capabilities.
2. Publish them through the existing site/project configuration path.
3. Hide rootfs, host placement, GPU, backup, move, SSH, and resource-limit
   controls in workspace mode.
4. Reject unsupported backend API calls.
5. Display the trusted-workspace warning to admins.
6. Make project status and errors describe workspace mode explicitly.

Exit gate:

- no unsupported feature appears to succeed;
- the developer can distinguish a workspace project from a real project host;
- ordinary project UX remains functional.

Expected effort: 1 to 2 focused engineering days.

### Phase 3: private hostname backend

Likely files:

- a new server module such as
  `packages/server/app-private-hostnames.ts`,
- `packages/server/cloud/dns.ts`,
- Conat hub system API declarations and implementation,
- project hard-delete cleanup,
- inter-bay cleanup/routing if required,
- project-host route lookup and rewrite,
- HTTP proxy authorization tests.

Work:

1. Verify Cloudflare edge and project-host origin certificate coverage for a
   one-level random `*.cocalc.ai` hostname before creating production records.
2. Add the private hostname table and idempotent schema creation or migration.
3. Add reserve, inspect, release, and reconcile operations.
4. Add account/project authorization at the API boundary.
5. Create proxied CNAME records using existing Cloudflare DNS helpers.
6. Add a private hostname lookup cache with bounded size and TTL.
7. Add project-host private rewrite without public authorization semantics.
8. Reuse browser-session bootstrap and collaborator checks.
9. Add app deletion, project deletion, and host-move reconciliation.
10. Add audit logging without tokens or sensitive URLs.

Exit gate:

- an authenticated collaborator can open the hostname;
- a signed-out browser cannot reach the app;
- a non-collaborator cannot reach the app;
- HTTP and WebSocket requests both work;
- collaborator removal revokes access;
- no public-access setting exists;
- no tunnel is created or used.
- edge-to-origin TLS succeeds without weakening the current TLS mode.

Expected effort: 2 to 4 focused engineering days.

### Phase 4: source-checkout developer command

Likely files:

- `src/package.json`
- `src/scripts/dev/workspace-site-daemon.sh`
- `src/scripts/dev/workspace-site-env.js`
- an app-spec generator or CLI helper
- developer documentation

Work:

1. Add named site initialization.
2. Add start, stop, restart, status, logs, and env.
3. Persist unique ports and paths.
4. Generate a private project app spec.
5. Add explicit private-hostname reserve/release commands.
6. Print browser and CLI environment information.
7. Detect stale processes and conflicting names.
8. Document Git worktree usage.

Exit gate:

- William and Blaec can each start a site from a clean source checkout using a
  short documented sequence;
- Blaec can run at least two sites concurrently;
- neither developer project contains cloud credentials.

Expected effort: 1 to 3 focused engineering days.

### Phase 5: end-to-end validation

Test matrix:

| Area                | Required validation                                                      |
| ------------------- | ------------------------------------------------------------------------ |
| Project lifecycle   | create, start, stop, restart, delete, concurrent start                   |
| Process recovery    | Launchpad crash, stale PID, PID reuse guard, unclean project exit        |
| Files               | create, edit, upload, download, persistence across restart               |
| Terminal            | open, reconnect, process list scoped to owned descendants                |
| Jupyter             | create notebook, start kernel, execute, reconnect                        |
| Codex/ACP           | one turn, reconnect, project restart                                     |
| Collaboration       | second trusted inner account can collaborate                             |
| Outer authorization | collaborator, non-collaborator, signed out, collaborator removed         |
| HTTP proxy          | ordinary requests, redirects, cookies, absolute URLs                     |
| WebSocket proxy     | Conat/browser socket, app sockets, reconnect                             |
| Parallel sites      | two source worktrees, independent DBs, independent inner projects        |
| Resource contention | one inner project cannot claim isolation; warning and diagnostics shown  |
| Cleanup             | stop site, stop outer project, delete app, release hostname              |
| Regression          | existing Podman runner, public-app-disabled behavior, Launchpad external |

Run focused package checks first, then:

```text
pnpm -C src tsc
pnpm -C src lint:frontend
pnpm -C src build:dev
```

Exit gate:

- a 24-hour run of two concurrent development sites has no orphan-process,
  reconnect, or hostname authorization failures;
- logs and recovery metadata are sufficient to diagnose failures;
- the ordinary private app URL remains a fallback.

Expected effort: 1 to 2 focused engineering days plus observation time.

## Migration of existing personal development sites

Migrate only after the prototype passes Phase 5.

### Preparation

Create three ordinary production CoCalc projects:

- `cocalc-dev-lite1`,
- `cocalc-dev-lite2`,
- `cocalc-dev-blaec`.

Names are illustrative. The important properties are:

- correct collaborator membership,
- sufficient outer project resources,
- no production operator credentials,
- no cloud-provider credentials,
- no Cloudflare credentials,
- source pushed to Git before migration,
- a documented list of non-secret local configuration to recreate.

### Per-site migration

For each current site:

1. Record current source branch, commit, local patches, environment variables,
   OAuth callbacks, test accounts, and required development data.
2. Push or archive every source change that matters.
3. Create the replacement outer project.
4. Clone the repository or create the required worktree.
5. Initialize the workspace development site.
6. Configure closed signup and sink-only email.
7. Reserve the private hostname.
8. Run the end-to-end smoke test.
9. Use the replacement for at least one working day.
10. Stop the old personal hub and its dedicated project-host resources.
11. Observe for a rollback period.
12. Delete old GCP, tunnel, DNS, and service-account resources only under a
    separately approved cleanup plan.

Suggested order:

1. `lite2b` or whichever William considers least critical,
2. `lite1b`,
3. Blaec.

Rollback is restarting the old development site. No production traffic or data
is moved.

## Effect on the infrastructure separation plan

This design simplifies but does not replace
`prod-dev-ops-infrastructure-separation-plan-2026-07-24.md`.

### Remove from the target design

Do not create four permanent personal-development GCP projects for:

- `lite1b`,
- `lite2b`,
- `lite4b`,
- `blaec`.

There are three active personal environments, not four, and the workspace
runtime removes their need for direct cloud infrastructure.

### Retain

Retain dedicated and isolated environments for:

- production,
- staging,
- operations/Alpha,
- one full-infrastructure development environment.

### Full-infrastructure development environment

Keep one isolated development GCP project for work that genuinely requires:

- project-host provisioning,
- GCP provider APIs,
- Cloudflare automation,
- rootfs and bootstrap development,
- ingress and certificate testing,
- host move/backup/recovery testing,
- cgroup and IO enforcement.

It should use:

- the development Cloudflare account and `cocalc.dev`,
- Stripe test mode only,
- strict GCP quotas,
- application-level host count and machine-size ceilings,
- no production IAM,
- no staging IAM,
- no production DNS or R2 access,
- no production database data.

This is not staging. Developers may break it freely. Staging remains a
production-like release gate and must not be used as a general backend
development sandbox.

### Staging

The staging plan is unchanged:

- separate GCP project,
- direct GCP ingress matching production,
- no Cloudflare tunnel,
- separate OAuth,
- Stripe test mode,
- sink/allowlisted email,
- synthetic data,
- bounded real GCP provisioning.

### Operations

The operations plan is unchanged:

- separate production-trusted GCP project,
- direct ingress,
- no dependency on personal developer projects,
- short-lived operator authentication,
- controlled production deployment and incident access.

The workspace-runtime project must never receive operations credentials.

## Operational diagnostics

The site status command should report:

- site name,
- source path,
- source commit and dirty state,
- Launchpad PID and process start identity,
- HTTP port,
- private app ID,
- private hostname,
- PGlite path and size,
- workspace project root and size,
- number of running inner projects,
- each project's PID, age, ports, and health,
- stale runtime records,
- recent child exits,
- log paths,
- runtime capabilities.

Do not log:

- bearer tokens,
- browser-session cookies,
- inner account passwords,
- registration tokens,
- OAuth secrets,
- arbitrary private route query strings.

## Rollback strategy

### Code rollback

- `COCALC_PROJECT_RUNTIME` defaults to `external` for Launchpad.
- Reverting workspace code leaves existing external Launchpad behavior.
- Private hostname routes can be disabled independently.
- Existing project app path URLs remain available.
- Public app exposure remains disabled throughout.

### Developer-site rollback

- Stop the replacement workspace site.
- Restart the old dedicated development environment during the observation
  window.
- Do not delete the old environment until the replacement has completed the
  agreed soak period.

### DNS rollback

- Release the private hostname record.
- Use the existing authenticated project app URL.
- A stale DNS record remains authorization-protected, but it must still be
  tracked and deleted.

## Risks and mitigations

| Risk                                               | Mitigation                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| Same-UID inner projects are mistaken for sandboxes | Persistent warning, trusted accounts only, explicit capability model        |
| A project kills sibling processes                  | Trusted-use scope, recovery metadata, outer project restart as hard reset   |
| Orphaned project daemons                           | PID start identity, startup adoption, bounded cleanup, outer container stop |
| Inherited outer credentials                        | Allowlisted child environment and negative tests                            |
| Private hostname accidentally bypasses auth        | Separate table/context, reuse normal collaborator authorizer, fail closed   |
| WebSocket remains after collaborator removal       | Existing revocation sweep plus explicit tests                               |
| DNS points to old host after project move          | Reconciler keyed by current outer project host                              |
| Cloudflare outage blocks hostname creation         | Existing private path URL remains usable                                    |
| Parallel sites collide on ports or data            | Named persisted allocations and startup preflight                           |
| Workspace UI claims unsupported limits             | Shared capabilities enforced in frontend and backend                        |
| Prototype becomes permanent undocumented product   | Checked-in docs, explicit mode, tests, and migration criteria               |
| Production project absorbs dev CPU or disk abuse   | Only trusted developers, outer quotas, per-site status, stop/reset tooling  |

## Estimate

The repository review lowers the estimate relative to a from-scratch design,
but the secure hostname handoff and lifecycle recovery are real work.

| Work                                         | Focused effort |
| -------------------------------------------- | -------------: |
| Architecture spike                           |   0.5-1.5 days |
| Workspace backend and Launchpad integration  |       2-4 days |
| Capabilities and UI correctness              |       1-2 days |
| Authenticated private hostnames              |       2-4 days |
| Developer command and parallel-site support  |       1-3 days |
| End-to-end fixes and documentation           |       1-2 days |
| Total prototype engineering                  |  7.5-16.5 days |
| Observation before deleting old environments |       1-3 days |

A narrow useful checkpoint should be available after approximately 3-5 focused
days:

- Launchpad workspace runtime,
- two concurrent inner projects,
- ordinary authenticated project app URL,
- manual source-checkout startup.

Private random hostnames and migration readiness likely put the complete
prototype near 1.5-3 engineering weeks. This is longer than the initial
under-one-week estimate because that estimate did not fully account for:

- fail-closed cross-hostname browser authorization,
- WebSocket revocation,
- robust child recovery and PID reuse,
- parallel named sites,
- capability/UI correctness,
- migration and rollback tooling.

The phases are independently useful. The hostname phase should not block
validating the workspace runtime through existing private app paths.

## Completion criteria

The prototype is complete when:

1. Workspace mode is explicit and off by default.
2. Two independent development sites run concurrently in one outer project.
3. Each site runs multiple logical projects without Podman.
4. Files, terminal, Jupyter, Codex, chat, and collaboration smoke tests pass.
5. Project process diagnostics do not expose unrelated outer-project processes.
6. Stop, crash, restart, and stale-process recovery are deterministic.
7. Each site can have an authenticated random hostname without a tunnel.
8. Signed-out and non-collaborator access fails closed for HTTP and WebSocket.
9. No public-access option exists.
10. No developer project contains Cloudflare, GCP, Nebius, production Stripe,
    production database, or operations credentials.
11. William and Blaec can perform normal work for at least 24 hours.
12. One old development environment can be stopped with a tested rollback.
13. The infrastructure separation plan is updated before destructive cleanup.

## First implementation sequence

Use the following commit sequence:

1. `project-runner: define runtime backend and mode`
2. `project-runner: add workspace process lifecycle`
3. `launchpad: enable explicit workspace runtime`
4. `project-runtime: expose workspace capabilities`
5. `project-apps: add authenticated private hostnames`
6. `dev: add named workspace site commands`
7. `dev: add workspace site browser smoke tests`
8. `docs: document workspace development and migration`

Do not combine the runtime and hostname implementation into one large commit.
The runtime must be testable through the existing private app URL before DNS or
hostname routing changes.

## Immediate next step

Implement Phase 0 as a throwaway test harness first, but commit only reusable
tests and production-quality seams. The first question to answer in executable
code is:

> Can current Launchpad project control start and connect to one foreground
> `cocalc-project` process with `host_id IS NULL`, a directory home, and a
> strictly constructed environment?

If yes, continue directly to the backend. If no, adjust the local lifecycle
routing explicitly before spending time on hostname UX.
