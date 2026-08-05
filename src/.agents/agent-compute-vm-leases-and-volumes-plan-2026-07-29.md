# Agent Compute VM Leases And Volumes Plan

Date: 2026-07-29

Last revised: 2026-08-01

Status: proposed implementation plan; this document does not change runtime or
production behavior.

> **Superseded:** The implementation scope was replaced on 2026-08-01 by
> [Project Compute VM MVP Implementation Plan](./project-compute-vm-mvp-implementation-plan-2026-08-01.md).
> This document is retained as design history and as a reference for deferred
> Codex orchestration, egress metering, and remote-job ideas. New implementation
> work should follow the replacement plan.

## Executive Decision

Build a deliberately small GCP-only compute product for AI agents:

- a **VM lease** is short-lived root compute with Docker-capable Ubuntu;
- a **volume** is explicitly created persistent storage;
- a volume can be attached read-write to exactly one VM lease;
- an authorized agent can grow an approved volume inside a human-set storage
  and recurring-cost envelope;
- the VM boot disk is disposable and deleted with the lease;
- a human uses fresh authentication to issue a bounded compute grant;
- an agent can act only inside that grant;
- CoCalc's existing Codex/ACP service can coordinate work on a lease without
  placing Codex credentials in the guest;
- SSH, command execution, and file transfer use ordinary direct SSH tools;
- outbound bytes are metered from GCP host-level metrics and sold at a simple
  fixed rate;
- one small `/settings/compute` page provides human authorization, visibility,
  volume management, and emergency controls;
- the CLI remains the primary interface.

This is a compute product. It is not a website-hosting product, a second
project runtime, or a restoration of the removed Compute Servers feature.

The first useful release should let an agent do this:

```bash
# Human action, after browser-backed fresh authentication.
cocalc compute authorize \
  --project "$PROJECT_ID" \
  --expires 8h \
  --max-vms 4 \
  --max-vm-ttl 4h \
  --max-compute-cost 25 \
  --max-egress 50GiB \
  --max-total-volume 750GiB \
  --max-monthly-volume-cost 100 \
  --allow-volume sage-pypy \
  --allow-volume-resize sage-pypy:750GiB

# Agent actions inside the approved project.
cocalc vm create \
  --arch arm64 \
  --machine t2a-standard-16 \
  --spot \
  --ttl 4h \
  --volume sage-pypy

cocalc vm ssh <vm>
cocalc vm exec <vm> -- bash -lc 'cd /work && docker build .'
cocalc vm cp <vm>:/work/dist ./dist
cocalc vm delete <vm>
```

After the lease and grant path is working, the same primitive should support a
Codex child run with either fresh context or a real fork of a stored Codex
thread:

```bash
# Start a new independent Codex thread. Codex stays on the trusted project
# host and uses the VM through the scoped compute CLI/SSH tool boundary.
cocalc project codex exec \
  --compute-vm <vm> \
  --fresh \
  --stdin \
  --json

# Branch the provider thread through one specific completed turn.
cocalc project codex exec \
  --compute-vm <vm> \
  --fork-session <session-id> \
  --fork-through-turn <turn-id> \
  --stdin \
  --json
```

These commands are a proposed contract, not current behavior. The Codex run
and its OpenAI authentication remain account-attributed. A compute grant pays
for and bounds compute; it does not grant, pool, or transfer somebody's Codex
subscription.

The lease expires even if the agent disconnects. The persistent volume remains
until a freshly authenticated human explicitly deletes it.

## Product Principles

The implementation should optimize for these goals in this order:

1. safe isolation from all CoCalc infrastructure;
2. bounded financial exposure;
3. agent-friendly CLI behavior;
4. simple implementation and operation;
5. preservation of useful intermediate work;
6. a narrow path to later extensions without implementing them now.

For agent integration, two authorizations remain deliberately independent:

- the compute grant bounds VM count, machine size, TTL, storage, egress, and
  cloud spend;
- the existing Codex authentication and payment-source policy bounds model
  access, account attribution, rate limits, and model usage.

The effective authority is the intersection of those two envelopes. Neither
one may silently widen the other.

The design should prefer visible, conventional primitives:

- a GCE VM;
- an external IPv4 address;
- an SSH public key;
- a zonal persistent disk;
- a hard expiration timestamp;
- a durable control-plane record;
- a published hourly and per-GiB price.

Do not add a guest control agent merely to make the product appear more
integrated. A root user can disable or replace any guest process, so the guest
must never be the authority for lifecycle, authorization, usage, or billing.

## User Problems Solved

The MVP should directly support:

- building Python packages inside Docker;
- building CoCalc Docker images;
- selecting x86-64 or ARM64 machines;
- obtaining hundreds of GiB of temporary workspace;
- preserving source trees, compiler output, package caches, and Docker layers
  across disposable VM leases;
- growing an approved persistent volume without interrupting an attached Linux
  build when it approaches capacity;
- starting, inspecting, logging, and canceling durable build/test jobs that
  survive an SSH or ACP disconnect;
- preventing unbounded Apport or systemd core-dump retention from silently
  exhausting the disposable root filesystem during native-package tests;
- running many independent temporary build or migration workers;
- connecting from a CoCalc project with standard SSH, `scp`, and `rsync`;
- connecting from a user's laptop with the same standard tools;
- letting an AI agent provision compute only after explicit human approval;
- letting a Codex session use a VM as a bounded remote build/test target;
- forking a Codex thread through a specified completed turn so several
  independent workers can pursue disjoint tasks with controlled context;
- starting a context-free Codex run when history would be irrelevant or
  undesirable;
- stopping spend automatically when TTL, funding, or egress limits are reached.

## Explicit Non-Goals

The first product will not implement:

- public website or application hosting;
- ports 80, 443, or arbitrary public port management;
- custom domains, TLS, Cloudflare routes, or reverse proxies;
- static IP addresses;
- long-lived VM identity;
- browser terminals into the VM;
- browser file managers for the VM;
- embedded Jupyter kernels;
- editor execution on the VM;
- automatic project file synchronization;
- FUSE or remote filesystem mounts into projects;
- snapshots, clones, backups, or cross-zone volume migration;
- multiple users or a general VM ACL;
- GPU machines;
- custom VM images;
- Windows;
- providers other than GCP;
- Kubernetes orchestration;
- automatic application health checks;
- guest-agent-based activity or billing telemetry;
- pooling, lending, or reselling one user's ChatGPT/Codex subscription to
  another account or to a project identity;
- automatically copying `~/.codex/auth.json`, an OpenAI API key, or a Codex
  access token into a general root VM;
- putting model-provider credentials in instance metadata, startup scripts,
  persistent volumes, or compute records;
- treating a compute grant as authorization for model usage;
- automatic idle detection;
- direct access to GCP APIs or credentials;
- compatibility with the removed Compute Servers implementation.

If website hosting is implemented later, it should be a separate product and
security design built on explicit ingress resources. It must not expand the VM
lease MVP by adding a generic "open port" escape hatch.

## Relationship To Existing Architecture

This design follows
[`scalable-architecture.md`](./scalable-architecture.md):

- auth, billing, directory, and account ownership stay in the control plane;
- an account-owned VM record has an explicit authoritative bay;
- project-scoped agents reach that authority through routed control-plane RPC;
- SSH and file transfer flow directly between the project or laptop and the VM;
- hubs do not proxy steady-state terminal, command, or file traffic.

The resource is account-owned, not project-owned:

- `owner_account_id` is the permanent owner and billing account;
- `owning_bay_id` is the owner's home bay at creation;
- an optional `project_id` binds a compute grant and its agent authority;
- moving or deleting the project does not transfer ownership of a volume;
- account rehoming must eventually rehome compute metadata, but not cloud
  resources.

Launchpad remains the one-bay case.

## Why This Is Not A Project Host

A project host contains platform services, credentials, routing state, project
placement, backups, and trusted control-plane software. Giving a user root on
such a host would expose platform secrets and other users' workloads.

An agent VM instead contains:

- a standard Ubuntu image;
- an SSH public key;
- a small disposable boot disk;
- optionally one explicitly attached user volume;
- no CoCalc project-host software;
- no Conat credentials;
- no object-storage credentials;
- no Cloudflare credentials;
- no provider credentials;
- no operator SSH private keys;
- no access to private CoCalc networks.

Do not add `kind = "agent-vm"` branches to `project_hosts`. Add a sibling
resource with separate lifecycle and security invariants.

## Lessons From Removed Compute Servers

The former Compute Servers product proved that users value root VMs, Docker,
ARM64, persistent disks, SSH, and batch compute.

It also accumulated broad coupling into:

- project editors;
- Jupyter;
- courses;
- file synchronization;
- custom images;
- web applications;
- container orchestration;
- health checks;
- cloud filesystems.

That coupling made the feature expensive to understand and maintain. This plan
preserves the useful cloud-compute primitive while rejecting transparent
integration. Standard SSH tools are the integration boundary.

## Core Security Model

### Treat every guest as hostile

The security model assumes that root can:

- modify or remove all files;
- disable SSH or networking;
- alter the kernel;
- disable or forge guest telemetry;
- install persistent backdoors on an attached volume;
- send arbitrary Internet traffic;
- listen on arbitrary local ports;
- inspect all instance metadata visible from the guest.

No correctness or financial decision may depend on guest cooperation.

### Dedicated untrusted GCP project

Agent VMs must run in a GCP project reserved for untrusted user compute.

That project must have:

- a dedicated VPC, not the default VPC;
- no Shared VPC attachment;
- no VPC peering;
- no Cloud VPN or Interconnect routes to CoCalc infrastructure;
- no routes to project-host, hub, database, storage-control, or operator
  networks;
- centrally managed ingress and egress firewall policies;
- no default service account privileges;
- quotas sized to the product limits;
- mandatory resource labels;
- a separate provider credential used only by the trusted control plane.

A separate project is a defense against IAM, firewall, and route configuration
mistakes. A separate VPC inside the project is not an adequate replacement for
the project boundary.

### Instance construction invariants

Every create request must explicitly set and later verify:

- no attached service account;
- no OAuth access scopes;
- `canIpForward = false`;
- no deletion protection;
- no Tier 1 networking;
- `networkTier = STANDARD`;
- one regional ephemeral external IPv4 address;
- IPv4-only networking;
- no external IPv6;
- project-wide SSH keys blocked;
- OS Login disabled unless a later design deliberately adopts it;
- only the platform-supplied, secret-free startup configuration;
- mandatory labels identifying environment and CoCalc resource IDs.

The implementation must not rely on omission to mean "no service account".
Post-create reconciliation must inspect the instance and quarantine/delete it
if a service account is unexpectedly attached.

### Metadata invariants

Instance metadata may contain:

- public SSH keys;
- a mount description;
- a lease ID;
- a non-secret expiration timestamp;
- a secret-free startup script.

It must not contain:

- private SSH keys;
- account API keys;
- project bearer tokens;
- fresh-auth session material;
- Conat credentials;
- cloud provider credentials;
- Cloudflare tokens;
- object-storage credentials;
- database connection strings;
- one-time credentials that remain useful after boot.

### Network policy

The VPC firewall permits:

- inbound TCP 22 to active agent VMs;
- outbound Internet traffic;
- response traffic required by those connections.

It denies:

- all other inbound traffic;
- east-west traffic between agent VMs;
- traffic to RFC1918 and other protected private ranges except required local
  infrastructure;
- traffic to CoCalc private networks;
- IP forwarding and source-routing bypasses.

Opening a service with `docker -p` or changing guest `iptables` does not make
the service publicly reachable because the GCP firewall still permits only
port 22.

The first version should use a direct external address, not Cloud NAT. Public
NAT adds a current `$0.045/GiB` processing charge in both directions and is not
needed for host-level byte metering.

### SSH trust

The first version uses ordinary public-key SSH:

- the CLI generates a dedicated Ed25519 key locally if requested;
- only the public key is sent to CoCalc;
- the private key remains in the project or laptop;
- password authentication is disabled;
- root login is allowed only by public key;
- the public key is injected at VM creation;
- the CLI records the VM host key on first connection using normal TOFU
  semantics.

The CLI must never upload, escrow, or log the private key.

An OpenSSH certificate authority is a possible later improvement, but it is
not required for owner-only disposable leases.

### Root persistence warning

A person or project that has had root may have left credentials or malware on
the persistent volume. Revoking a compute grant prevents new control-plane
operations but does not make an already used volume trustworthy.

The first version is owner-only. If a grant is bound to a collaborative
project, the UI must state that anybody who can run commands as the project
user can use the project's private SSH key and therefore obtain root on the VM.

## Codex Execution Architecture

### Keep inference identity out of the hostile guest

The default and MVP architecture is:

```text
human or parent agent
        |
        v
existing CoCalc ACP/Codex app-server on the trusted project host
        |
        | scoped compute API for lifecycle; direct SSH for data-plane tools
        v
root-controlled leased VM
```

The Codex process, stored thread, account identity, subscription or API-key
selection, usage governor, and provider connection stay in the existing
project-host Codex boundary. The lease receives only its SSH public key and
non-secret task data. Initially Codex can use the already proposed
`cocalc vm exec`, `cp`, and `rsync` commands explicitly. A later remote-workspace
adapter may expose scoped `exec`, `read`, `write`, `apply_patch`, `stat`,
`upload`, and `download` operations over the same direct SSH connection.

This is intentionally different from copying a full Codex installation and
credentials into every VM. The guest security model grants root and assumes
all guest processes and checked-out repositories may be hostile. Any secret
placed in that environment must be considered readable and exfiltratable.

The first integration should use the ordinary local/project worktree as the
source of truth and the VM for expensive builds, tests, searches, and generated
artifacts. Synchronization remains explicit. If a future remote-workspace mode
makes the VM the source of truth, it must be a separately visible mode rather
than implicit bidirectional synchronization.

### Context modes

Every Codex compute run must select exactly one context mode:

- `fresh`: call `thread/start`; include the new task, applicable system and
  developer policy, repository `AGENTS.md`, and a small compute-target
  manifest, but no prior conversation;
- `fork`: call the Codex App Server `thread/fork` on an account- and
  project-authorized source thread; optionally pass `lastTurnId` so the new
  thread contains history only through one specified completed turn;
- `resume`: call `thread/resume` on the same stored child thread and continue
  its existing workspace assignment.

`fresh` is the default when no context option is supplied. `fork` must return a
new provider thread ID before work is enqueued. `resume` is never implemented
by copying text into a new prompt. A source session ID and `lastTurnId` are
opaque identifiers; the server validates ownership and project access instead
of accepting transcript text supplied by the caller.

CoCalc already has the important foundation:

- ACP requests carry `account_id`, `project_id`, session configuration, and
  payment-source metadata;
- `project codex exec --session-id` resumes stored sessions;
- the App Server bridge calls provider `thread/resume`;
- the chat UI and ACP server call provider `thread/fork` for chat forks;
- subscription, account API key, project API key, and site API key are distinct
  resolved auth sources.

The compute implementation should extend `AcpForkSessionRequest` and
`forkCodexAppServerSession` with optional `lastTurnId`, then attach the resulting
child session to a compute-run record. Do not build a second transcript or fake
fork mechanism in the compute service.

### Authentication and provider-policy boundary

Current OpenAI guidance distinguishes ChatGPT sign-in for subscription access
from API-key sign-in for usage-based access. It recommends API keys as the
default for programmatic automation, describes ChatGPT-managed auth on trusted
CI runners as an advanced mode, and says to treat `auth.json` like a password.
The App Server documentation also asks new enterprise integrations to identify
their client and contact OpenAI about the known-client list for compliance
logs.

Therefore:

- every run has a real initiating `account_id`; a bare project identity cannot
  inherit a collaborator's personal ChatGPT subscription;
- child sessions may reuse the initiating account's resolved auth source, but
  may not change it merely because the compute-grant owner is different;
- model usage, rate limits, service tier, and payment source continue through
  the existing Codex governor and session accounting;
- when an account owns multiple connected Codex subscriptions, the run records
  and uses one explicit credential profile rather than an ambiguous account
  default;
- compute records store only redacted auth-source and payment-source IDs, never
  tokens or API-key material;
- CoCalc must not automate browser login in the VM, multiplex one personal
  subscription across accounts, or turn subscription auth into a site key;
- the integration advertises a stable CoCalc App Server `clientInfo`, and the
  production launch checklist includes contacting OpenAI about known-client
  registration and any enterprise compliance requirements;
- provider-specific auth placement is controlled by a server-side policy with
  an immediate kill switch, so a provider policy change can disable one mode
  without disabling VM leases.

The compute product does not attempt to reinterpret provider terms. Before
production, the supported auth/placement matrix must be reviewed against the
then-current official provider documentation and, where needed, confirmed with
the provider.

### Multiple subscription profiles per CoCalc account

One CoCalc human may control more than one separately paid OpenAI
account/subscription. The credential model should support that directly instead
of forcing one `auth.json` per CoCalc account, encouraging manual secret
copying, or requiring fake CoCalc users.

The current external credential selector is effectively unique on:

```text
(provider, kind, scope, owner_account_id, project_id, organization_id)
```

and `upsertExternalCredential` updates the newest matching live row. Thus a
second account-scoped `codex-subscription-auth-json` currently replaces the
first. Before subscription fan-out, extend the generic credential model with a
stable `profile_id` (or add an equivalent normalized profile table) and include
it in selector uniqueness, routing, encryption context, revocation, listing,
and audit.

Each Codex subscription profile contains:

- an opaque CoCalc credential/profile ID;
- owner `account_id`;
- provider and credential kind;
- provider account/workspace ID derived from verified auth, used for duplicate
  detection and never accepted merely from user input;
- a user-chosen label such as `pro-1` or `research-2`;
- masked provider login identity for display;
- observed plan type and current rate-limit status;
- created, refreshed, last-used, expired, and revoked timestamps;
- whether the owner has enabled it for automatic agent scheduling;
- encrypted credential payload in the existing bay-owned credential store.

Do not put an email plus-address in a uniqueness or security decision. The
verified provider account/workspace ID is authoritative; the email is display
metadata.

Suggested CLI:

```bash
cocalc project codex auth subscription login --profile pro-1
cocalc project codex auth subscription login --profile pro-2
cocalc project codex auth subscription list
cocalc project codex auth subscription status --profile pro-1
cocalc project codex auth subscription revoke --profile pro-1

# Explicit selection.
cocalc project codex exec --codex-profile pro-2 ...

# Select among this initiating account's profiles that have opted into
# scheduling, using current rate-limit status and per-profile concurrency.
cocalc project codex exec --codex-profile auto ...
```

The OAuth/device flow is completed by the same CoCalc human owner for every
profile. CoCalc does not create OpenAI accounts or buy subscriptions on the
user's behalf. Automatic selection is constrained to profiles owned by the
initiating CoCalc account and explicitly enabled for scheduling. Every run
records the chosen profile before provider thread creation so attribution and
cancellation remain deterministic.

Concrete existing touchpoints that must become profile-aware include:

- `ExternalCredentialSelector` and the `external_credentials` lookup/upsert
  queries, with a real partial unique index for live profile identity;
- `SUBSCRIPTION_CREDENTIAL_SELECTOR` and every registry get/has/touch/sync
  operation;
- `resolveSubscriptionCodexHome(accountId, profileId)`, with separate cache
  directories and GC usage for each profile;
- `resolveCodexAuthRuntime`, whose `contextId` must include profile ID so two
  subscriptions never reuse one app-server container/auth context;
- device-auth start/status/cancel and auth upload, all of which require an
  explicit profile target;
- `CodexSessionConfig`, ACP session metadata, `AiSessionRecord` payment-source
  fields, and provider thread creation;
- the usage-status poller and ACP/Codex admission governor, which must report
  and limit the selected profile rather than an account-global fiction.

Backfill the current single account credential as profile `default`. Adding the
profile to authenticated-encryption associated data requires a controlled
decrypt/re-encrypt migration; do not strand existing auth blobs. Concurrent
profile creation must fail or deduplicate on verified provider account ID
instead of racing two live rows into existence.

This first-class path is safer than users copying many `auth.json` files:

- encrypted secrets remain in the authoritative credential bay;
- refreshing one profile cannot silently overwrite another;
- the UI can show which identity is active, rate-limited, expired, or revoked;
- the scheduler can make a deterministic choice without scanning directories;
- audit and usage records identify the exact paid profile;
- revocation does not depend on finding every manually copied file.

Provider terms remain the external policy boundary. The design permits several
paid profiles owned by one human when the provider permits that; it does not
share one profile between unrelated users, counterfeit extra profiles, or hide
the selected provider identity.

### Optional resident Codex runner

Running `codex exec` or `codex app-server` inside the lease may be useful later,
especially when the VM itself is the authoritative workspace. It is not the
default MVP posture.

Any managed resident-runner design requires a separate threat and terms review:

- API-key automation should prefer a narrow per-run proxy or capability so the
  root guest never receives the underlying long-lived key;
- a proxy capability must be bound to one account, run, model policy, expiry,
  and usage budget, and remain useless for compute-control APIs;
- ChatGPT-managed auth or enterprise access tokens may be used only where
  official provider policy permits it and the VM is explicitly treated as a
  trusted private runner, not as the general hostile-guest profile;
- credential material may never be written to a persistent user volume or
  instance metadata;
- revocation and lease expiry must terminate both the agent process and its
  provider capability independently of guest cooperation.

This later mode changes a core invariant: a scoped secret becomes visible to
root, even if only briefly. It must be separately authorized and labeled in the
UI and audit log. A user's manual decision to SSH into their own VM and install
Codex is possible without product support, but CoCalc must not silently copy
their existing credentials there.

#### A read-only Codex disk is provenance, not isolation

A read-only persistent disk containing a pinned Codex binary is useful for
fast startup, reproducible versions, and supply-chain provenance. It does not
make app-server technically trusted against root in the same VM.

Even if the binary is static, signed, addressed by an exact path, and mounted
read-only, guest root controls the kernel and can generally:

- inspect process memory, file descriptors, pipes, and `/proc` state;
- trace or inject into the process;
- replace or interpose the dynamic loader and libraries when they are not part
  of an independently protected image;
- alter DNS, routing, certificate trust, and syscall behavior;
- capture any bearer credential after the trusted binary receives it.

Secure Boot, measured boot, `fs-verity`, and a read-only disk improve code
provenance but do not protect a process from the administrator of its running
kernel. Confidential VMs primarily protect a guest from the cloud host; they do
not ordinarily protect one guest process from root inside that guest. A
TEE/enclave design with remote attestation could change this conclusion, but it
would be a distinct research project with a much narrower tool and filesystem
boundary.

There are therefore two honest product postures:

1. **Secretless guest.** Run the exact trusted Codex app-server binary in
   CoCalc's existing credential-managed Codex boundary, or in a separate
   trusted sidecar that does not share the guest kernel. Give it scoped SSH
   tools into the root VM. No model credential enters the lease. This is the
   MVP and strongest technical boundary.
2. **Owner-credential guest.** Deliver the initiating human's own Codex
   credential ephemerally to an exact pinned binary in that human's private
   root VM. Root can technically capture it; the boundary is the provider's
   terms of service plus the owner's explicit consent, not cryptographic
   isolation from the owner. This is analogous to a user running Codex on a
   machine they administer.

The second posture can still reduce accidental exposure:

- require fresh confirmation from the credential owner for that run or bounded
  run window;
- prohibit it for a collaborative project or any VM whose root SSH key is
  available to another account;
- send credentials directly to the trusted app-server login protocol rather
  than instance metadata, disk, shell history, command arguments, or logs;
- use tmpfs, disable swap, avoid `auth.json`, and destroy the boot disk at run
  end;
- mount the pinned Codex/tools image read-only and verify its digest before
  delivery;
- record the exact account, client version, VM, run, expiry, and consent event;
- rely on provider rate limits and immediate credential revocation for abuse
  response.

These controls reduce mistakes; they do not stop malicious root. The mode must
never receive a site credential, another person's subscription, or a key that
CoCalc intends to keep secret from the VM owner. Several distinct subscription
profiles owned by that same human may be scheduled independently when provider
terms permit it, but each remains a separately authenticated and audited
provider identity with its own limits.

A read-only tools disk is worth considering in both postures. Its claim is
“pinned immutable distribution,” never “root cannot steal app-server
credentials.”

### Parallel fan-out

The architecture should make a bounded Sage-style development sprint a normal
case:

1. a coordinator identifies disjoint tasks and one completed source turn;
2. it asks ACP for one provider-native fork per task, optionally through that
   exact turn;
3. grant admission leases one VM per child, subject to VM and aggregate
   vCPU/RAM/cost limits;
4. every child gets a unique run ID, VM ID, worktree or volume directory, and
   task manifest;
5. children cannot contact one another over the private network and do not
   share writable worktrees;
6. each child returns a structured result containing commit or patch identity,
   validation results, artifact hashes, timing, and remaining caveats;
7. the trusted coordinator or a human reviews and merges results.

The maximum number of simultaneous Codex turns is a separate server-side
limit from `max_active_vms`. Starting twenty VMs does not authorize twenty model
sessions, and starting twenty model sessions does not authorize twenty VMs.
Cancellation can stop a child turn without deleting its VM, or terminate the
run and request VM deletion, but the requested behavior must be explicit.

VM stdout, files, and generated summaries are untrusted tool output. They may
inform the model but never override system/developer policy, expand a grant,
select a new payment source, or authorize another child run.

## Economics And Capacity Strategy

### Compute and inference have different shapes

Spot compute is exceptionally well matched to agent work:

- compilation, tests, linear algebra, and search are batch workloads;
- the ACP thread and coordinator survive outside the disposable VM;
- Git commits and persistent volumes provide natural checkpoints;
- an agent can detect a lost SSH target, provision a replacement inside the
  same grant, reattach the volume, and continue;
- large machines shorten feedback loops enough to improve the agent's work,
  not merely the wall-clock benchmark.

GCP currently advertises Spot discounts of up to 91%, but prices are variable,
can change, and capacity can be reclaimed at any time. Admission must use the
live catalog price and snapshot it for the lease. Product copy should say
“current Spot price,” not promise a permanent 90% discount.

Using the motivating estimate of `$200/month` for a 32-vCPU, 128-GiB Spot VM:

```text
illustrative hourly cost       = $200 / 730 ~= $0.274/hour
one four-hour worker           ~= $1.10
ten four-hour workers          ~= $10.96
one hundred four-hour workers  ~= $109.59
```

These are illustrations, not catalog prices. The CLI should calculate the same
table from the immutable price snapshot before a human authorizes the grant.
At this price, model access, engineering attention, persistent storage, or
egress can cost more than CPU. Egress is especially avoidable for software
research: keep package/compiler caches on a volume or versioned tools disk and
return small commits, patches, logs, and benchmark summaries.

### Subscription capacity is not a token contract

Current OpenAI documentation describes the `$200/month` Pro 20x tier in terms
of approximate local-message ranges in a shared five-hour window, with task
complexity, context, model, reasoning, caching, tool use, and possible weekly
limits all affecting consumption. It does not promise a fixed number of tokens
per subscription. CoCalc should therefore measure useful completed work, not
convert a subscription into a fictional token balance.

For every run, retain the already available redacted usage fields:

- input, cached-input, output, and reasoning-output tokens;
- model, reasoning level, and service tier;
- wall time and active tool time;
- VM type, VM hours, egress, and persistent-storage cost;
- outcome: completed, useful patch/commit, tests passed, interrupted, retried,
  or discarded.

The useful operating metric is approximately:

```text
cost per accepted result
  = allocated model cost or subscription share
  + VM/volume/egress cost
  + review and merge cost
```

Subscription rate-limit status is a scheduling signal, not a grant. A fan-out
controller should queue or reduce concurrency when the initiating account's
Codex window is constrained, and may choose a lower-cost/high-volume model for
bounded mechanical tasks. It may select among the initiating human's connected,
automation-enabled subscription profiles. It must not use unrelated accounts,
an unconnected collaborator credential, or multiple copies of one profile
represented as if they were independent subscriptions.

The first real experiment should use existing subscriptions rather than buy a
large speculative pool:

1. run two weeks of representative Sage.js tasks;
2. cap at a small fleet such as four large Spot VMs per active coordinator;
3. record accepted-result throughput, provider window pressure, and compute
   utilization;
4. use API-key/credits as explicit overflow where appropriate;
5. only then decide whether more subscription profiles owned by that human,
   additional human seats, Business/Enterprise capacity, or API usage is the
   economical scaling path.

Five to ten `$200/month` subscriptions would be `$1,000-$2,000/month`, roughly
the same order as several continuously running large Spot VMs under the
illustrative estimate. That may be excellent value if each subscription belongs
to a provider account actually controlled and connected by the CoCalc owner and
produces independent accepted work. CoCalc should make such owner-managed
profiles easy to connect and audit; it should not itself manufacture accounts
or conceal which profile is running. For a shared multi-human organizational
fleet, use provider-supported delegation, team/enterprise seats, or a
usage-priced arrangement.

### Recovery policy

The platform does not need automatic Spot replacement in the first compute
MVP. The agent can request a replacement through the same idempotent CLI and
grant. The run record should include a bounded retry policy:

- maximum replacements;
- maximum total VM-hours and fixed cost across replacements;
- whether to reattach the same volume;
- last durable Git commit and artifact manifest;
- whether interruption should resume the same Codex thread or fork a recovery
  child.

Later, repeated successful agent-driven recovery can justify moving this policy
into the orchestrator. The control plane still enforces the aggregate envelope;
an agent's ability to recover is never authority to spend without limit.

## Product Resource Model

The MVP has exactly three user-visible durable resource types:

1. compute grants;
2. VM leases;
3. persistent volumes.

It also has internal work, usage, and audit records.

### `compute_grants`

Recommended fields:

```sql
CREATE TABLE compute_grants (
  id UUID PRIMARY KEY,
  owner_account_id UUID NOT NULL,
  owning_bay_id UUID NOT NULL,
  project_id UUID NOT NULL,
  issued_by_account_id UUID NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by_account_id UUID,
  max_active_vms INTEGER NOT NULL,
  max_total_vcpus INTEGER NOT NULL,
  max_ram_gb INTEGER NOT NULL,
  max_boot_disk_gb INTEGER NOT NULL,
  max_total_volume_gb INTEGER NOT NULL,
  max_monthly_volume_cost_usd NUMERIC NOT NULL,
  max_vm_ttl_seconds INTEGER NOT NULL,
  max_fixed_cost_usd NUMERIC NOT NULL,
  max_egress_gib NUMERIC NOT NULL,
  allowed_architectures TEXT[] NOT NULL,
  allowed_machine_types TEXT[] NOT NULL,
  allowed_pricing_models TEXT[] NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'
);
```

Use normalized grant-volume rows in the first implementation. Each row must
identify the allowed volume and record `allow_attach`, `allow_resize`, and a
human-approved `max_size_gb`. The grant-level total-GiB and monthly-cost limits
bound all such rows together. A resize persists after the short-lived grant
expires, so authorization must display and record the maximum continuing
monthly storage charge, not merely the cost through grant expiration.

A grant is:

- issued only after browser-backed fresh authentication;
- bound to one owner and one project;
- short-lived;
- revocable;
- unable to create volumes;
- unable to delete volumes;
- unable to expand its own limits;
- usable only for VM operations and explicitly approved grow-only volume
  resizes within its stored envelope.

The grant is server-side authority. Do not return a general fresh-auth cookie
or reusable account credential to the project.

### `compute_vms`

Recommended fields:

```sql
CREATE TABLE compute_vms (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  owner_account_id UUID NOT NULL,
  owning_bay_id UUID NOT NULL,
  project_id UUID,
  grant_id UUID,
  provider TEXT NOT NULL,
  provider_instance_id TEXT,
  region TEXT NOT NULL,
  zone TEXT NOT NULL,
  architecture TEXT NOT NULL,
  machine_type TEXT NOT NULL,
  pricing_model TEXT NOT NULL,
  boot_disk_gb INTEGER NOT NULL,
  state TEXT NOT NULL,
  desired_state TEXT NOT NULL,
  public_ip INET,
  ssh_user TEXT NOT NULL DEFAULT 'root',
  ssh_public_key_fingerprint TEXT NOT NULL,
  attached_volume_id UUID,
  created_at TIMESTAMPTZ NOT NULL,
  ready_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  interrupted_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  delete_requested_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  fixed_cost_per_hour NUMERIC NOT NULL,
  egress_price_per_gib NUMERIC NOT NULL,
  egress_baseline_bytes BIGINT,
  egress_observed_bytes BIGINT NOT NULL DEFAULT 0,
  egress_finalized_at TIMESTAMPTZ,
  billing_state TEXT NOT NULL,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'
);
```

Use top-level columns for fields required by admission, reconciliation, expiry,
billing, and list views. Provider response details and non-authoritative
diagnostics belong in `metadata`.

### `compute_volumes`

Recommended fields:

```sql
CREATE TABLE compute_volumes (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  owner_account_id UUID NOT NULL,
  owning_bay_id UUID NOT NULL,
  provider TEXT NOT NULL,
  provider_disk_id TEXT,
  region TEXT NOT NULL,
  zone TEXT NOT NULL,
  disk_type TEXT NOT NULL,
  size_gb INTEGER NOT NULL,
  desired_size_gb INTEGER NOT NULL,
  filesystem TEXT NOT NULL DEFAULT 'ext4',
  state TEXT NOT NULL,
  attached_vm_id UUID,
  attachment_generation BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  ready_at TIMESTAMPTZ,
  resize_requested_at TIMESTAMPTZ,
  resized_at TIMESTAMPTZ,
  detach_requested_at TIMESTAMPTZ,
  detached_at TIMESTAMPTZ,
  delete_requested_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  cost_per_hour NUMERIC NOT NULL,
  billing_state TEXT NOT NULL,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE (owner_account_id, name)
);
```

The first release supports:

- GCP `pd-balanced`;
- zonal disks;
- creation at a human-approved initial size;
- grow-only enlargement while detached or attached;
- one ext4 filesystem;
- one read-write attachment;
- mount at the fixed path `/work`;
- explicit deletion.

Do not implement shrink, snapshot, clone, or cross-zone move.
Do not make the mount path configurable in MVP.

Online enlargement is a first-release requirement. A human may authorize one
resize directly with fresh authentication or preauthorize bounded agent
resizes in a compute grant. Provider-disk growth is authoritative for billing;
filesystem growth is performed over the ordinary direct SSH boundary and is
never trusted for authorization or cost enforcement.

### Internal work table

Do not change the production project-host `cloud_vm_work` contract merely to
share a table in the first implementation.

Add an isolated durable `compute_resource_work` queue with:

- `id`;
- `resource_kind` in `vm | volume`;
- `resource_id`;
- `action`;
- `payload`;
- `state`;
- `not_before`;
- `attempt`;
- `locked_by`;
- `locked_at`;
- `error`;
- timestamps;
- idempotency key.

Reuse or extract queue helper code when that is low risk. Do not route agent VM
work through `host-work.ts`, which contains project-host bootstrap, DNS,
Cloudflare, placement, rootfs, and health assumptions.

### Audit events

Every mutation should append an audit event containing:

- actor identity type;
- actor account or project ID;
- charged account ID;
- grant ID if used;
- resource type and ID;
- action;
- request and idempotency IDs;
- fresh-auth decision;
- old and new lifecycle state;
- normalized envelope and price snapshot;
- provider operation ID where applicable;
- result or error.

Never include private keys, auth cookies, or provider credentials.

### Internal Codex compute-run link

Do not add a fourth cloud resource merely because an ACP turn targets a VM.
Keep the Codex thread and turn in the existing ACP/session stores, and add a
small durable link record such as `compute_agent_runs` for orchestration and
audit:

```sql
CREATE TABLE compute_agent_runs (
  id UUID PRIMARY KEY,
  owner_account_id UUID NOT NULL,
  actor_account_id UUID NOT NULL,
  project_id UUID NOT NULL,
  vm_id UUID NOT NULL,
  grant_id UUID NOT NULL,
  agent_provider TEXT NOT NULL,
  execution_placement TEXT NOT NULL,
  context_mode TEXT NOT NULL,
  source_session_id TEXT,
  source_turn_id TEXT,
  session_id TEXT NOT NULL,
  codex_auth_source TEXT NOT NULL,
  codex_credential_profile_id UUID,
  payment_source_kind TEXT,
  payment_source_id TEXT,
  workspace_path TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'
);
```

`execution_placement` initially has the value `project-host-remote-tools`.
Possible future values require an explicit policy review; in particular,
`vm-resident` must never be inferred from the presence of a Codex binary.

The record references ACP history rather than duplicating prompts or
transcripts. `metadata` may contain redacted model configuration, artifact
manifests, usage totals, and hashes, but not hidden context, bearer tokens,
subscription files, API keys, SSH private keys, or raw environment dumps.

The owner pays for compute. The actor's resolved Codex payment source pays for
model usage unless an existing project or site API-key policy explicitly says
otherwise. Both identities are recorded so a collaborative project never
turns owner-pays compute into accidental owner-pays personal subscription use.
When the actor owns multiple subscription profiles, the selected profile ID is
also immutable for the run; resume does not silently switch identities.

## Fresh Authentication And Agent Authority

### Direct human actions

These actions require cookie-backed fresh authentication:

- issue a compute grant;
- expand or extend a grant;
- create a volume;
- resize a volume;
- delete a volume;
- create a VM without a compute grant;
- increase a VM TTL outside its grant;
- increase a VM resource or egress envelope;
- enable a managed VM-resident agent mode or deliver any provider credential
  capability to a guest;
- override billing enforcement;
- perform admin repair or force-detach operations.

API keys, bearer tokens, project credentials, and raw hub-password auth do not
satisfy this requirement.

### Agent actions inside a grant

A project identity may perform only:

- list grants visible to that project;
- list and inspect VMs created under its grant;
- create a VM inside the envelope;
- wait for readiness;
- obtain the public SSH endpoint;
- extend TTL up to the grant maximum and grant expiration;
- delete its VM;
- inspect allowed volume names and attachment state;
- grow an allowed volume when its grant row permits resize and the requested
  size remains inside both the per-volume and aggregate storage/cost envelope;

When the caller is also an authenticated Codex account session, it may create,
fork, resume, interrupt, and inspect its own ACP turns using the existing Codex
admission and concurrency policy. That authority comes from the initiating
account's Codex session, not from the compute grant. A project bearer by itself
cannot select or consume a human collaborator's subscription.

The agent may not:

- create or delete a volume;
- attach a volume not named by the grant;
- operate another project's VM;
- spend beyond the grant;
- extend the grant;
- open a public port;
- access account or payment credentials;
- obtain fresh-auth session material.
- read or select another account's Codex auth or payment source;
- export Codex credentials or a general CoCalc bearer token to the VM.

### Grant admission transaction

VM creation must lock the grant row and atomically verify:

- current time is before `expires_at`;
- `revoked_at IS NULL`;
- the caller is the bound project identity;
- active VM count remains within the grant;
- aggregate vCPU and RAM remain within the grant;
- machine, architecture, pricing model, and zone are allowed;
- boot disk and TTL are within limits;
- estimated fixed cost through expiration is within the remaining budget;
- requested egress allowance is within the remaining budget;
- requested volume is explicitly allowed and currently unattached;
- owner billing admission succeeds.

Creating a linked Codex compute run additionally verifies, without weakening
the VM transaction above:

- the VM is `ready`, belongs to the same project/grant, and has not expired;
- the initiating account may access both the project and the source ACP
  session;
- a requested fork source and `lastTurnId` exist and are in a completed state;
- the requested child-session concurrency is inside the Codex admission limit;
- the resolved Codex auth and payment source belong to or are legitimately
  available to the initiating account under existing project/site policy;
- an explicitly selected subscription profile belongs to the initiating
  account; `auto` considers only that account's automation-enabled profiles;
- fork/resume uses a profile for the same provider account/workspace as the
  stored source thread, and resume preserves the run's immutable profile;
- context mode and execution placement are allowed by current provider policy.

The VM reservation and Codex admission need not share one database
transaction, but partial failure must be compensated. A failed child-session
start leaves the VM usable and records the failed run; it does not leak a
concurrency reservation or delete useful persistent work.

Only after this transaction records a VM and reserves grant capacity should it
enqueue provider work.

Provider failure releases the reservation transactionally and records an audit
event.

Volume resize admission separately locks the grant and volume rows and
atomically verifies:

- the volume is explicitly allowed with `allow_resize = true`;
- the requested size is larger than the current provider size and no larger
  than the per-volume maximum;
- aggregate approved volume GiB and continuing monthly cost remain inside the
  grant;
- owner billing admission succeeds at the new persistent rate;
- no conflicting attach, detach, delete, or resize operation is active.

The operation reserves the larger size before provider work is enqueued. The
agent cannot change the grant limits or shrink the volume.

### Dangerous RPC registry

Every new public RPC with names such as `create`, `delete`, `attach`, `detach`,
`authorize`, `extend`, `resize`, `repair`, or `reconcile` must be added to
`dangerous-rpc-registry.ts` with an explicit decision.

Internal worker and reconciliation endpoints must be `internal-auth-only`.

## VM Lease Lifecycle

The lifecycle is intentionally small:

```text
requested
  -> provisioning
  -> starting
  -> ready
  -> deleting
  -> deleted
```

Exceptional states:

```text
provisioning_failed
interrupted
egress_blocked
billing_blocked
delete_failed
```

### Create

Create performs:

1. authorization and grant admission;
2. billing admission and immutable price snapshot;
3. durable VM row insertion;
4. optional volume attachment reservation;
5. durable provider work enqueue;
6. GCE instance and disposable boot disk creation;
7. optional existing volume attachment;
8. public IP and provider identity persistence;
9. post-create security invariant inspection;
10. readiness publication.

The public API returns an LRO immediately. The CLI may wait and show structured
progress.

### Ready

`ready` means:

- provider reports the instance running;
- the expected public IPv4 address exists;
- the instance security invariants match;
- TCP 22 accepts connections;
- any requested volume is attached;
- the TTL monitor owns a durable expiration record.

It does not claim that arbitrary user software is healthy.

### Expiration

`expires_at` is authoritative in the control plane.

The expiry worker:

1. prevents extension without authorization;
2. asks GCP to stop the instance if it is still sending traffic;
3. confirms the provider is no longer running;
4. detaches and fences the persistent volume;
5. deletes the VM and disposable boot disk;
6. preserves the volume;
7. keeps polling final network metrics;
8. closes billing after the final metric settlement window.

Guest clocks and guest shutdown hooks are irrelevant.

### Explicit delete

An agent may delete a VM created under its active grant. Deletion is
idempotent. It follows the same safe detach and final billing path as expiry.

VM deletion must never delete the persistent volume.

### Spot interruption

For the first release:

- provider interruption changes the VM to `interrupted`;
- billing for running compute stops;
- the volume remains attached or is safely detached during reconciliation;
- the user or agent creates a replacement lease in the same zone;
- no automatic cross-zone fallback occurs;
- no automatic reconstruction of boot-disk state is promised.

Automatic restart may be added later if it can reuse the same instance safely
inside the original TTL and grant. It is not required for MVP correctness.

## Persistent Volume Lifecycle

The lifecycle is:

```text
requested
  -> provisioning
  -> available
  -> attaching
  -> attached
  -> detaching
  -> available
  -> deleting
  -> deleted

available -> resizing -> available
attached  -> resizing -> attached
```

Exceptional states:

```text
provisioning_failed
attachment_unknown
detach_failed
delete_failed
billing_blocked
```

### Creation

Volume creation:

- requires fresh authentication;
- displays hourly and approximate monthly cost before confirmation;
- selects one GCP zone permanently;
- creates an unformatted zonal `pd-balanced` disk;
- records a durable billing session;
- does not create a VM.

The first attaching VM may initialize an empty disk as ext4. Initialization
must use a filesystem probe and a unique volume identity. It must never run
`mkfs` merely because a mount failed.

### Attachment and fencing

Attachment requires:

- matching owner;
- matching zone;
- an active grant that names the volume;
- `attached_vm_id IS NULL`;
- a provider check that no other instance has the disk attached;
- a transaction that increments `attachment_generation`;
- a durable attach work item tied to that generation.

Completion is accepted only when the work item's generation still matches the
volume. A stale worker cannot attach after a newer detach or attachment
decision.

### Detachment

Deleting or expiring a VM:

- stops the VM before detach when possible;
- requests provider detach;
- verifies the provider attachment is gone;
- clears `attached_vm_id`;
- increments `attachment_generation`;
- returns the volume to `available`.

If provider state is unknown, the volume remains `attachment_unknown`. It
cannot be attached elsewhere until reconciliation proves the old attachment
gone or an administrator performs a freshly authenticated repair.

### Deletion

Volume deletion:

- requires fresh authentication;
- requires typed confirmation of the volume name;
- is rejected while attached or attachment state is unknown;
- stops future billing only after provider deletion is confirmed;
- is idempotent;
- initially has an operator-configurable short recovery delay before provider
  deletion.

VM TTL never implies volume deletion.

### Grow-only resize

Resize is an idempotent long-running operation keyed by volume, requested
size, and request ID. It must:

1. complete fresh-auth or grant-envelope admission;
2. reserve `desired_size_gb` and the higher continuing storage charge;
3. call the provider's grow-only disk resize operation;
4. reconcile the actual provider size by immutable disk ID;
5. set `size_gb` to the confirmed provider size and update billing;
6. if detached, mark filesystem growth pending for the next attachment;
7. if attached and requested by the caller, use direct SSH to verify that
   `/work` is the expected ext4 volume and run bounded online `resize2fs`;
8. verify the block-device and filesystem sizes and return both in structured
   output.

Every attachment must also compare the ext4 filesystem with the provider disk
and safely finish any pending grow before publishing the mount ready. It must
never run `mkfs` or attempt shrink as a recovery action. If provider growth
succeeds but the database commit fails, reconciliation adopts the larger
provider size and corresponding charge. If filesystem growth fails, retain the
larger disk, report `filesystem_resize_pending`, and allow an idempotent retry.

### Billing failure

Persistent storage cannot be retained forever without valid billing.

The first release should:

1. warn and block new attachments;
2. keep the detached volume for a documented grace period;
3. notify the owner repeatedly;
4. require operator review before the first production deletion policy is
   enabled.

There is no automatic backup in MVP, so automatic deletion on billing failure
must remain disabled until the retention policy has been reviewed explicitly.

## GCP Provider Implementation

### Do not reuse `createHost` as-is

The current `GcpProvider.createHost` is project-host-oriented. It assumes:

- project-host machine metadata;
- default-subnet conventions;
- a boot disk plus project-host data-disk behavior;
- project-host startup scripts;
- project-host SSH users;
- project-host lifecycle semantics.

Add a narrow GCP agent-compute implementation, sharing low-level credential,
operation-wait, machine-type, disk-type, and status helpers where safe.

Suggested package boundary:

```text
src/packages/server/compute/
  admission.ts
  api.ts
  audit.ts
  billing.ts
  egress.ts
  grants.ts
  lifecycle.ts
  reconcile.ts
  volumes.ts
  worker.ts
  providers/
    gcp.ts
```

Shared provider types should describe agent compute explicitly rather than
overloading `HostSpec`.

### Initial machine catalog

Use a small allowlist rather than the entire GCP catalog.

The first catalog should include:

- one small x86 machine;
- one medium x86 machine;
- one large x86 machine;
- one medium ARM64 machine;
- one large ARM64 machine;
- on-demand and Spot where GCP supports them.

For example, site configuration may allow selected `n2d`, `t2d`, and `t2a`
types. Exact SKUs should come from the existing cloud catalog cache, but the
product allowlist is explicit and versioned.

Do not expose arbitrary custom machine definitions in MVP.

### Boot image

Use one pinned Ubuntu 24.04 LTS image family or immutable image version.

The platform startup script should only:

- create or configure root SSH authorization;
- disable password authentication;
- prepare the optional volume mount;
- write non-secret lease diagnostics;
- avoid installing a platform agent.

Docker installation can initially be performed by the agent. A later
secret-free cached image with Docker preinstalled is an optimization, not an
MVP requirement.

The first release must nevertheless provide an idempotent SSH bootstrap
command for build workers. When a persistent volume is attached, it configures
Docker's data root below `/work`, creates documented persistent cache roots for
pip, cibuildwheel, ccache, and temporary build artifacts, and verifies that
Docker can restart using the same state. Deleting or replacing the disposable
VM must not delete those layers or caches. A trusted Docker-cached boot image
may optimize startup later but is not required for persistence.

The same bootstrap must apply a bounded crash-artifact policy. Ubuntu Apport,
systemd-coredump, and equivalent native crash paths may be disabled or retained
under an explicit byte/count/age quota, but they must never accumulate without
bound under `/var` or another disposable-root path. Durable jobs record the
policy and report root and `/work` free space before launch. If crash artifacts
are retained for debugging, place or copy them into a bounded per-job directory
under `/work` and include their hashes in the job manifest.

## Egress Metering And Cost Control

### Product price

Define the billable product metric as:

> Bytes sent by the VM network interface, billed at `$0.10/GiB`.

This is a CoCalc published price, not an attempt to reproduce individual GCP
invoice line items.

Use:

```text
compute.googleapis.com/instance/network/sent_bytes_count
```

This metric:

- is collected outside the guest;
- requires no guest monitoring agent;
- cannot be disabled by root;
- is attributed to a GCE instance;
- is sampled every 60 seconds;
- can be delayed for several minutes.

The isolated network makes total sent bytes a conservative approximation of
public Internet egress. CoCalc deliberately charges the published interface
byte metric even if a small portion would not be billable by GCP.

### Why Standard Tier

Force Standard Tier because:

- its public Internet egress price is based on source region, not destination;
- current first-tier marginal cost is below the `$0.10/GiB` product price;
- China and Australia destinations do not create Premium Tier destination
  price spikes;
- the normal non-Tier-1 external rate is bounded;
- no delayed destination classification is required.

Do not offer Premium Tier or Tier 1 networking.

### Polling and accumulation

The egress monitor should:

- poll every minute;
- query by immutable instance ID, project, and zone;
- store the latest complete sample end time;
- process each delta interval exactly once;
- tolerate missing and late samples;
- never treat a missing sample as zero;
- preserve raw observation metadata for audit;
- update `egress_observed_bytes` transactionally;
- append metered purchase usage incrementally;
- continue polling after stop/delete until the settlement deadline.

Do not use the VM name alone because names can be reused.

### Enforcement

Every VM has an approved egress allowance derived from its grant.

The allowance is an enforcement target, not an exact byte-level hard cap.
Cloud Monitoring and provider stop latency permit bounded overshoot. The CLI
and settings page must disclose the current worst-case overshoot estimate
before authorization.

Recommended initial policy:

- 70%: show warning;
- 80%: prohibit TTL extension;
- issue provider stop at the earlier of 90% or the dynamically calculated
  safety-reserve threshold;
- 100%: keep stopped and require new fresh human authorization.

Calculate:

```text
worst_case_unobserved_bytes
  = maximum_external_bytes_per_second
  * (
      metric_sampling_interval
    + metric_max_visibility_delay
    + monitor_poll_interval
    + provider_stop_deadline
    )

safety_stop_bytes
  = max(0, approved_egress_bytes - worst_case_unobserved_bytes)
```

The stop threshold is:

```text
min(90% of approved_egress_bytes, safety_stop_bytes)
```

Stopping is a two-step provider operation:

1. issue `instances.stop`;
2. if the provider does not confirm `TERMINATED` by the recorded stop deadline,
   issue `instances.delete`.

The boot disk is disposable and the external persistent volume is created with
`autoDelete = false`, so escalation to instance deletion is the correct safety
action. If neither operation is confirmed, fence the volume, page an operator,
and keep retrying through a separate high-priority cleanup queue. The exposure
calculation is a bound while the GCP control plane remains responsive; global
GCP quotas and per-account concurrency limits are the final backstop during a
provider control-plane incident.

If the resulting threshold is too low to make the VM useful, admission may
still permit the lease only when the human explicitly accepts the separately
displayed overshoot exposure and the site-wide per-VM risk limit remains
satisfied. The product must not describe this as a hard egress quota.

Site configuration must include:

- monitor polling interval;
- metric settlement delay;
- warning and stop fractions;
- maximum per-VM egress allowance;
- maximum account aggregate allowance;
- emergency global egress stop.

### Exposure bound

The safety calculation is:

```text
maximum unobserved cost
  <= maximum allowed external bandwidth
   * (
       metric sampling interval
     + maximum metric visibility delay
     + monitor polling interval
     + provider stop deadline
     )
   / bytes_per_GiB
   * conservative provider cost per GiB
```

The admission service should calculate and record this bound for each allowed
machine type. A machine type is not offered if its worst-case exposure exceeds
the configured site risk limit. The user-facing authorization should also show
the corresponding maximum product-charge overshoot at `$0.10/GiB`.

### Billing reconciliation

GCP Billing Export may be used for periodic operator auditing, but it is not in
the customer billing path.

The customer bill is based on:

- immutable VM hourly price snapshots;
- immutable volume GB-hour price snapshots;
- external IPv4 price included in the VM hourly rate;
- host-level bytes sent at `$0.10/GiB`.

This avoids delayed destination and SKU attribution in the product.

## Compute And Volume Billing

Reuse the dedicated-host funding concepts:

- account prepaid;
- account postpaid with a valid usage subscription;
- 5-hour rolling exposure;
- 7-day rolling exposure;
- unbilled postpaid exposure;
- owner-pays accounting;
- site-funded admin mode for staging and canaries.

Use distinct purchase identities:

```text
service = "agent-compute"
tag = "agent-vm:<vm_id>"

service = "agent-compute"
tag = "agent-volume:<volume_id>"

service = "agent-compute"
tag = "agent-egress:<vm_id>"
```

Recommended behavior:

- VM fixed compute accrues while GCP bills the running instance;
- disposable boot-disk and external-IP cost are included in the VM rate;
- a volume accrues continuously from provider creation through confirmed
  deletion, whether attached or detached;
- egress accrues through `cost_so_far`;
- all rates and surcharges are snapshotted at resource creation;
- a stopped/interrupted VM does not accrue CPU/RAM cost;
- provider resources are reconciled independently of purchase-session state.

The settings page and CLI must show:

- current hourly VM rate;
- current hourly and approximate monthly volume rate;
- observed egress GiB and charge;
- approved fixed compute cost and egress allowance as separate values;
- TTL;
- whether values are observed, estimated, or finalizing.

## API Design

Prefer Conat RPC APIs over new Next API routes.

Suggested public account API methods:

```text
compute.listGrants
compute.authorizeGrant
compute.revokeGrant

compute.listVms
compute.getVm
compute.createVm
compute.extendVm
compute.deleteVm

compute.listVolumes
compute.getVolume
compute.createVolume
compute.resizeVolume
compute.deleteVolume
```

Suggested project-scoped methods:

```text
compute.listProjectGrants
compute.listProjectVms
compute.createProjectVm
compute.extendProjectVm
compute.deleteProjectVm
compute.getProjectVmSshEndpoint
compute.resizeProjectVolume
```

Suggested internal methods:

```text
compute.claimWork
compute.completeWork
compute.failWork
compute.reconcileResource
compute.recordEgressObservation
compute.expireDueVms
compute.enforceBilling
```

Codex orchestration remains in ACP rather than becoming a provider-specific
`compute.runCodex` RPC. Extend the existing ACP contract narrowly:

```text
AcpRequest.config.computeTarget = {
  vm_id,
  run_id,
  workspace_path,
  mode: "project-host-remote-tools"
}

AcpForkSessionRequest.lastTurnId? = <provider turn id>
```

The ACP admission path resolves `vm_id` through the project-scoped compute API,
creates the internal run link, and injects only redacted target metadata plus
the scoped CLI environment needed to call direct SSH tools. It does not inject
the VM's SSH private key into an API payload; the key remains in the project
filesystem or local CLI key store as already specified.

The provider-native fork must complete before the child run is queued. Store
the returned thread ID, source thread ID, and optional source turn ID. If fork
succeeds but later admission fails, retain or archive the empty child thread
and record the compensation result instead of silently losing its identity.

All create and delete methods accept idempotency keys. All long-running cloud
mutations return an LRO ID.

Read APIs must return normalized, redacted objects. Do not return provider
credentials, raw startup scripts, or full instance metadata.

## CLI Contract

The CLI is the primary data-plane UX.

### Human authorization

```bash
cocalc compute authorize \
  --project <project> \
  --expires 8h \
  --max-vms 4 \
  --max-vcpus 64 \
  --max-compute-cost 25 \
  --max-egress 50GiB \
  --max-total-volume 750GiB \
  --max-monthly-volume-cost 100 \
  --max-vm-ttl 4h \
  --arch amd64,arm64 \
  --pricing spot,on-demand \
  --allow-volume sage-pypy \
  --allow-volume-resize sage-pypy:750GiB

cocalc compute grants
cocalc compute revoke <grant>
```

If fresh auth is missing, the CLI uses the existing structured
`fresh_auth_required` error and prints the browser elevation command. It never
falls back to bearer or API-key authorization.

### Volume operations

```bash
cocalc volume create sage-pypy \
  --size 500GiB \
  --type balanced \
  --zone us-central1-a

cocalc volume list
cocalc volume get sage-pypy
cocalc volume resize sage-pypy --size 750GiB --wait
cocalc volume delete sage-pypy
```

Creation prints:

- zone permanence;
- hourly price;
- approximate 30-day price;
- the fact that billing continues while detached;
- the fact that VM TTL never deletes the volume.

Resize accepts `--json`, returns an LRO, is grow-only, and reports the old,
requested, and confirmed provider sizes plus the continuing monthly-cost
change. For an attached volume, `--grow-filesystem` uses the same direct SSH
path as `vm exec`; otherwise the CLI reports that ext4 growth will complete on
the next attachment. Project agents may invoke it only inside a grant's
explicit resize envelope.

### VM operations

```bash
cocalc vm create \
  --arch arm64 \
  --machine t2a-standard-16 \
  --spot \
  --ttl 4h \
  --volume sage-pypy

cocalc vm list
cocalc vm get <vm>
cocalc vm wait <vm>
cocalc vm extend <vm> --ttl 2h
cocalc vm delete <vm>
cocalc vm bootstrap <vm> --docker --persistent-build-cache
```

`create` should:

- discover the current project from the standard CLI context;
- find an active compatible grant;
- create a local dedicated SSH key if none is selected;
- submit only its public key;
- print progress to stderr;
- print a stable result to stdout;
- support `--json`;
- optionally wait until SSH is ready.

### Direct SSH tools

These commands execute locally and do not proxy data through the hub:

```bash
cocalc vm ssh <vm>
cocalc vm exec <vm> -- <command...>
cocalc vm cp <source> <destination>
cocalc vm rsync <source> <destination>
cocalc vm ssh-config <vm>
```

The CLI should print the equivalent ordinary command with `--dry-run`.

Examples:

```bash
cocalc vm exec build-arm -- uname -m
cocalc vm cp . build-arm:/work/src
cocalc vm rsync build-arm:/work/dist/ ./dist/
```

No SSH payload, terminal stream, or file content passes through Conat or a hub.

### Durable remote jobs

Long package builds and test suites must not depend on one SSH connection
remaining open. The first release provides:

```bash
cocalc vm job start <vm> --name sage-cp314 -- bash -lc '<command>'
cocalc vm job status <vm> <job>
cocalc vm job logs <vm> <job> --follow
cocalc vm job cancel <vm> <job>
```

These are direct SSH helpers implemented with conventional guest facilities
such as systemd transient services. They do not introduce a privileged CoCalc
guest agent or make guest status authoritative for billing. With a volume
attached, the launcher, bounded logs, PID/unit metadata, timestamps, and final
exit code live below `/work/runs/<run_id>/jobs/<job_id>` so an ACP restart,
SSH disconnect, or replacement coordinator can reconcile the job. VM loss is
reported as interruption, never silently converted to success or an automatic
duplicate. The run manifest records the last durable Git commit and artifact
hashes needed for an authorized replacement VM to continue.

### Codex compute runs

Extend the existing `project codex exec` surface instead of introducing a
second Codex CLI:

```bash
# Fresh provider thread with no chat history.
cocalc project codex exec \
  --compute-vm <vm> \
  --fresh \
  --stdin \
  --json

# Provider-native fork through a specific completed turn.
cocalc project codex exec \
  --compute-vm <vm> \
  --fork-session <session-id> \
  --fork-through-turn <turn-id> \
  --stdin \
  --json

# Continue an existing child on its assigned VM.
cocalc project codex exec \
  --compute-vm <vm> \
  --session-id <child-session-id> \
  --stdin \
  --json
```

`--fresh`, `--fork-session`, and `--session-id` are mutually exclusive.
`--fork-through-turn` requires `--fork-session`. Omitting all three means
`--fresh`; there is no implicit reuse of whichever chat happens to be open.

For agents and awkward multiline prompts, accept one JSON request from stdin:

```bash
cocalc project codex exec --request-json --json <<'EOF'
{
  "prompt": "Build and benchmark the modular-symbols kernel.",
  "context": {
    "mode": "fork",
    "session_id": "thr_source",
    "last_turn_id": "turn_completed"
  },
  "compute": {
    "vm_id": "build-arm",
    "workspace_path": "/work/runs/modsym-arm"
  }
}
EOF
```

Human output shows VM, workspace, context mode, source and child session IDs,
execution placement, model, auth-source label, and both compute and model
payment sources. `--json` returns stable fields including `run_id`, `vm_id`,
`session_id`, `turn_id`, state, usage, and error. `--jsonl` continues to stream
the existing ACP events, augmented with a run/VM binding event.

Do not print prompts, subscription tokens, API keys, SSH private-key paths, or
full environments merely because `--verbose` is set.

### Batch creation

The MVP may support:

```bash
cocalc vm create --count 20 ...
```

This enqueues ordinary independent VM creates with stable idempotency keys.
Do not add a separate fleet scheduler initially.

JSON output must make every created VM and failed item individually
identifiable.

## Minimal Frontend

Add one settings page:

```text
/settings/compute
```

Register `compute` as a normal settings leaf in:

- `src/packages/util/types/settings.ts`;
- `src/packages/frontend/account/settings-page-registry.ts`;
- `src/packages/frontend/account/settings-navigation.ts`.

Hide it when:

- running Lite without managed cloud support;
- the site setting disables agent compute;
- the account has no eligibility and is not an admin.

The page is for human control, not interactive VM use.

### Page header

Show:

- "Agent compute";
- a concise explanation of disposable root VMs and persistent volumes;
- current account eligibility;
- current fixed-spend and egress limits;
- a link or copyable command for CLI setup;
- a warning that this is not website hosting.

### Compute grants

Show:

- project;
- expiration;
- active VM count;
- approved vCPU, cost, TTL, egress, and volume envelope;
- creator;
- revoke button;
- "Authorize project" button.

The authorization modal requires fresh auth and keeps advanced choices
collapsed. Defaults should be conservative and useful.

The page must clearly state:

> Any collaborator who can run commands in this project can use this grant and
> its project SSH key to obtain root on the approved VMs.

### Active and recent VMs

Use one compact table or list showing:

- name and ID;
- project;
- architecture and machine type;
- Spot/on-demand;
- state;
- public IP;
- attached volume;
- remaining TTL;
- hourly price;
- observed egress and charge;
- total estimated charge;
- delete or emergency-stop action;
- copyable `cocalc vm ssh ...` command.

Do not embed a terminal.

### Persistent volumes

Show:

- name;
- size;
- type;
- zone;
- state;
- attached VM;
- hourly price;
- approximate monthly price;
- create, grow-only resize, and delete actions.

Deletion requires fresh auth and typed name confirmation.

### Small UI scope guard

The page must not add:

- a file browser;
- command execution;
- VM logs beyond bounded lifecycle diagnostics;
- package installation;
- public port controls;
- DNS controls;
- snapshots;
- image builders;
- collaborator ACLs;
- a general cloud console.

## Site And Membership Configuration

Recommended site settings:

```text
agent_compute_enabled
agent_compute_gcp_project_id
agent_compute_allowed_regions
agent_compute_allowed_zones
agent_compute_allowed_machine_types
agent_compute_allowed_pricing_models
agent_compute_default_ttl_seconds
agent_compute_max_ttl_seconds
agent_compute_default_egress_gib
agent_compute_max_egress_gib
agent_compute_egress_price_per_gib
agent_compute_max_unobserved_egress_cost
agent_compute_volume_min_gb
agent_compute_volume_max_gb
agent_compute_volume_grace_days
agent_compute_global_max_active_vms
agent_compute_global_max_vcpus
agent_compute_emergency_stop
```

Provider credentials remain secret settings and use the existing secret-setting
component in admin UI.

The first production rollout should use an account allowlist or admin-only
gate. Membership-tier fields can follow:

```text
agent_compute_max_active_vms
agent_compute_max_vcpus
agent_compute_max_volume_gb
agent_compute_max_grant_fixed_cost
agent_compute_max_grant_egress_gib
agent_compute_allowed
```

Do not silently grant fallback capacity to tiers that have no configured
values. An absent or zero entitlement means unavailable.

## Reconciliation And Orphan Safety

The reconciler is authoritative outside the guest.

It must periodically:

- list all provider VMs with the agent-compute environment label;
- list all provider disks with the agent-compute environment label;
- match them to database resources by immutable IDs;
- enqueue expiry for overdue VMs;
- repair stale running/stopped state;
- verify security invariants;
- stop or delete VMs with no valid database owner after a short quarantine;
- preserve and quarantine orphan disks for operator review;
- verify one-writer volume attachment;
- close or repair billing sessions;
- continue final egress collection after VM stop;
- report global quota and risk totals.

Orphan policy differs by resource:

- an orphan VM creates continuing compute and egress risk, so stop it quickly;
- an orphan volume may be the only copy of user data, so never delete it
  automatically in MVP.

## Failure Semantics

### Hub or worker restart

- queued and in-progress work is reclaimed by lock timeout;
- idempotency prevents duplicate provider resources;
- provider operation IDs are persisted;
- expiry remains durable;
- direct SSH continues while the control plane restarts.

### Provider create timeout

- inspect by immutable labels and requested provider ID before retrying;
- adopt the matching instance if creation succeeded remotely;
- never create a second instance merely because the first response timed out.

### Database commit failure after provider create

- labels allow the reconciler to discover the orphan;
- stop it before attempting adoption;
- adopt only when ownership, grant, and price records are unambiguous;
- otherwise quarantine and alert.

### Volume attachment uncertainty

- enter `attachment_unknown`;
- prohibit another attachment;
- inspect provider attachment state;
- require fresh-auth admin repair if reconciliation cannot prove safety.

### Monitoring gaps

- missing egress metrics never reset usage;
- TTL and fixed-cost enforcement continue;
- prohibit TTL extension when egress observations are stale beyond the safety
  window;
- optionally stop the VM if telemetry remains unavailable long enough to break
  the configured exposure bound.

### Billing exhaustion

- stop the VM through the provider API;
- preserve the volume;
- block new leases and attachments;
- show the recovery action;
- do not trust the guest to shut down;
- keep finalizing delayed egress.

### Volume resize uncertainty

- inspect the provider disk by immutable ID before retrying;
- adopt and bill a larger provider size even when the original response or
  database commit was lost;
- never roll back by shrinking;
- keep `filesystem_resize_pending` separate from provider resize success;
- permit bounded SSH filesystem-growth retries without repeating provider
  growth.

### SSH or coordinator disconnect during a job

- the durable guest service continues independently of the SSH stream;
- reconnecting clients read the on-volume job manifest and bounded log;
- cancellation is idempotent;
- absent durable exit evidence is `running`, `interrupted`, or `unknown`, never
  success;
- retry uses a new job ID and preserves the first attempt's evidence.

### Guest root-disk pressure

- bootstrap verifies the bounded core-dump policy before package work starts;
- durable job admission records free bytes on both `/` and `/work` and may
  reject a caller-specified insufficient-capacity threshold;
- logs, exit records, build caches, and recoverable artifacts live on `/work`;
- filling the disposable root is a failed or interrupted attempt, never a
  reason to discard the persistent volume or infer job success;
- replacement bootstrap identifies and reports any retained crash artifacts
  before resuming work.

## Observability

Operator status should include:

- active VM count by region, zone, architecture, and pricing model;
- active vCPU and RAM totals;
- persistent volume count and GiB;
- VMs nearing TTL;
- stale egress metrics;
- current and worst-case unobserved egress exposure;
- grant utilization and rejection reasons;
- queue age and failure counts;
- orphan and security-invariant violations;
- attachment-unknown volumes;
- purchase-session reconciliation state;
- provider quota utilization.

Alerts should be actionable:

- unexpected service account attached;
- Premium or Tier 1 networking detected;
- forbidden firewall or route drift;
- egress metric stale beyond the safety window;
- global unobserved exposure over threshold;
- expired VM still running;
- orphan VM;
- volume attached to multiple instances;
- provider resources with missing owner labels.

Do not page on ordinary user command failure or expected Spot interruption.

## Implementation Phases

### Phase 0: threat model and isolated GCP foundation

Deliver:

- dedicated staging GCP project;
- dedicated VPC and subnet;
- firewall and organization policy;
- provider service account limited to the untrusted project;
- explicit no-VM-service-account enforcement;
- Standard Tier and IPv4-only enforcement;
- quotas and labels;
- documented operator teardown.

Exit criteria:

- a root VM cannot obtain a GCP service-account token;
- it cannot reach any CoCalc private address;
- it cannot reach another agent VM;
- opening port 8080 in the guest does not expose it publicly;
- provider API can stop and delete it regardless of guest state.

### Phase 1: admin CLI lease without persistent volume

Deliver:

- `compute_vms`;
- isolated work queue and worker;
- GCP create/status/delete;
- TTL;
- SSH key injection;
- CLI create/wait/ssh/exec/cp/delete;
- durable SSH-backed job start/status/logs/cancel;
- site-funded admin admission;
- one x86 and one ARM64 machine;
- lifecycle audit events.

Exit criteria:

- an admin can create a lease from a project, run Docker as root, copy an
  artifact back, and allow TTL to delete the VM;
- worker and hub restarts do not leak provider resources;
- no website-hosting functionality exists.

### Phase 2: persistent volumes

Deliver:

- `compute_volumes`;
- freshly authenticated create/resize/delete;
- zonal `pd-balanced`;
- bounded grant-authorized grow-only resize and online ext4 growth;
- attach generation and fencing;
- mount at `/work`;
- idempotent Docker/bootstrap configuration with Docker layers and build caches
  below `/work`;
- detach and preserve on VM expiry;
- continuous volume billing record;
- CLI volume commands.

Exit criteria:

- write a checksum-protected workspace;
- delete the first VM;
- attach the same volume to a new VM;
- verify all data;
- prove concurrent attachment is rejected;
- prove VM TTL never deletes the volume;
- grow a nearly full attached volume without stopping its durable build job;
- verify provider and ext4 sizes after growth;
- replace the VM and prove Docker layers, compiler caches, job logs, and source
  state remain usable;

### Phase 3: compute grants and agent authority

Deliver:

- `compute_grants`;
- fresh-auth issuance and revocation;
- project-bound envelope;
- transactional admission;
- dangerous RPC registry coverage;
- project-scoped CLI create inside grant;
- project-scoped resize inside an explicit per-volume and aggregate
  storage-cost envelope;
- no general account credential in the project.

Exit criteria:

- a project bearer cannot create a VM without a grant;
- a human can authorize a bounded grant;
- the project can create only inside the envelope;
- grant expiration and revocation block new work;
- the project cannot create or delete volumes and can resize only explicitly
  approved volumes inside every size and cost bound.

Phases 2 and 3 may be swapped during implementation, but both are required
before non-admin agent use.

### Phase 3A: Codex remote-compute integration

Deliver:

- the existing project-host ACP/Codex app-server as the trusted coordinator;
- `computeTarget` metadata on ACP requests and an internal compute-run link;
- `lastTurnId` support through the existing ACP and App Server fork path;
- explicit `fresh`, `fork`, and `resume` CLI context modes;
- `--compute-vm`, `--request-json`, stable `--json`, and augmented `--jsonl`;
- a generated run manifest and unique `/work/runs/<run_id>` directory;
- a built-in compute skill or equivalent instructions for direct
  `vm exec/cp/rsync` use;
- separate compute-grant and Codex-session admission;
- bounded child-session fan-out and cancellation;
- auth/payment-source/run audit metadata with all credentials redacted;
- named multiple-subscription profiles, explicit/automatic profile selection,
  and per-profile live rate-limit status;
- a provider-policy kill switch for execution placement and auth modes.

Exit criteria:

- a fresh run contains no source conversation history;
- a fork through turn `T` contains provider history through `T` and no later
  turns, and receives a distinct child thread ID;
- resume continues that child instead of creating a text-simulated copy;
- four child sessions can use four independent leases and work directories
  under one bounded grant;
- a project collaborator cannot consume another collaborator's personal
  ChatGPT subscription merely because the latter owns the compute grant;
- one account can connect two distinct subscription profiles without either
  overwriting the other, select each explicitly, and revoke them independently;
- automatic selection never leaves the initiating account's enabled profile
  set and never changes profile during resume;
- the VM contains no `auth.json`, OpenAI API key, Codex access token, general
  CoCalc bearer, or SSH private key;
- revoking the compute grant blocks new VM/run bindings but does not corrupt
  stored ACP threads or persistent volumes;
- malicious guest output cannot expand either the compute or Codex envelope;
- model usage and compute cost are separately attributable and visible.

This phase does not require a VM-resident Codex process or transparent remote
filesystem. Those remain separate later decisions.

### Phase 3B: owner-credential resident-runner canary

This is an optional, separately authorized experiment after the secretless
remote-compute path works. It exists because users who administer their own
private VM can already copy several `auth.json` files there manually; a managed
path can make the same trust decision explicit, auditable, revocable, and much
less error-prone.

Deliver:

- an exact-version Codex tools image mounted read-only and verified by digest;
- an owner-only VM eligibility check that rejects collaborative root access;
- explicit consent explaining that VM root can capture the selected credential;
- one selected subscription profile per resident app-server process;
- ephemeral credential injection into tmpfs or the app-server login protocol,
  never instance metadata, persistent disk, command arguments, or logs;
- profile-specific process directories, concurrency limits, usage status, and
  revocation;
- native `fresh`, `fork`, and `resume` behavior identical to Phase 3A;
- lease-expiry and revocation hooks that terminate the process and destroy the
  disposable boot disk even when the guest is uncooperative;
- a provider-policy kill switch independent of secretless remote execution.

Exit criteria:

- one owner can select either of two independently authenticated subscription
  profiles without copying or renaming `auth.json` files;
- two resident processes never share a profile directory, token cache, provider
  thread, or rate-limit state;
- the user-facing consent and audit record identify the profile, VM, Codex
  digest, expiry, and fact that root is inside the credential trust boundary;
- no credential appears in persistent volumes, instance metadata, process
  arguments, shell history, structured output, or platform logs;
- revoking one profile terminates only runs using that profile and prevents
  resume without silently switching identities;
- an interrupted Spot run resumes from stored provider/session and workspace
  state only after fresh admission and credential resolution;
- disabling resident execution leaves the Phase 3A secretless path operational.

This phase does not claim to hide credentials from malicious root. Its security
boundary is the authenticated owner's consent plus provider terms, with strong
controls against accidental leakage and cross-account use.

### Phase 4: PAYG and egress enforcement

Deliver:

- fixed compute price sessions;
- persistent volume price sessions;
- `$0.10/GiB` host-level egress metering;
- monitoring settlement;
- warnings and provider stop;
- 5-hour, 7-day, and postpaid exposure checks;
- account and global kill switches.

Exit criteria:

- observed bytes match a controlled transfer within the documented tolerance;
- root cannot disable measurement;
- delayed samples are billed exactly once;
- a synthetic egress threshold stops the VM;
- maximum observed overshoot stays inside the configured site risk bound;
- final charges settle after deletion.

### Phase 5: one settings page

Deliver:

- `/settings/compute`;
- grant authorization and revocation;
- active/recent VM list;
- volume create/list/delete;
- TTL, cost, and egress visibility;
- emergency stop/delete;
- CLI command copy buttons;
- entitlement and site-setting visibility.

Exit criteria:

- a human can safely authorize an agent without using an admin page;
- all destructive persistent-storage actions require fresh auth;
- the page remains a control surface rather than a remote VM console.

### Phase 6: staging stress and production canary

Deliver:

- concurrent create/delete stress;
- Spot interruption tests;
- worker crash and orphan tests;
- egress stress;
- volume fencing stress;
- staging runbook and evidence;
- admin-only production canary after explicit review.

Do not enable Pro or general customer access in this phase.

## Test Plan

### Unit tests

Cover:

- every grant envelope dimension;
- grant expiration and revocation;
- fresh-auth enforcement and bearer bypass rejection;
- dangerous RPC registry decisions;
- owner and project routing;
- immutable price snapshots;
- TTL transitions;
- idempotent create/delete;
- worker lock recovery;
- provider timeout adoption;
- fresh/fork/resume context-mode validation and mutual exclusion;
- provider-native fork propagation of `lastTurnId`;
- source ACP session ownership and completed-turn checks;
- independent compute and Codex concurrency admission;
- compute owner versus Codex actor/payment-source attribution;
- multi-profile uniqueness, duplicate provider-account detection, selection,
  per-profile concurrency, refresh, expiry, and independent revocation;
- redaction of Codex auth, SSH keys, and environment values from run records;
- no-service-account request construction;
- Standard Tier and IPv4-only request construction;
- forbidden metadata keys;
- volume attachment generation;
- grow-only resize admission, aggregate limits, idempotency, billing changes,
  and shrink rejection;
- provider-resize/database-commit recovery and filesystem-pending retries;
- delete-while-attached rejection;
- VM deletion preserving volume;
- egress delta deduplication;
- late and missing metric samples;
- egress threshold transitions;
- purchase-session close and recovery;
- frontend route registration and visibility.

### Staging integration tests

Run against the dedicated untrusted staging project:

1. create x86 on-demand;
2. create ARM64 Spot;
3. verify `uname -m`;
4. install and run Docker;
5. build and copy an artifact;
6. verify metadata exposes no service-account credentials;
7. scan protected private ranges and confirm denial;
8. open an arbitrary guest port and confirm public denial;
9. create a persistent volume;
10. write data and record checksums;
11. expire the VM;
12. attach the volume to a replacement;
13. verify checksums;
14. attempt a concurrent attachment;
15. interrupt Spot;
16. restart workers during provider create;
17. delete the database-side LRO response path and verify orphan adoption;
18. generate controlled outbound traffic;
19. verify monitoring lag and cumulative bytes;
20. trigger egress stop;
21. verify final billing settlement;
22. create 20 VMs concurrently;
23. exercise grant max-count, fixed-compute-cost, and egress rejection;
24. revoke a grant during active work;
25. verify existing SSH continues but new VM operations stop;
26. run a fresh Codex child and verify it inherited no conversation history;
27. fork a Codex thread through an earlier completed turn and prove later
    turns are absent;
28. resume the child on the same VM/workspace assignment;
29. run four children on four independent work directories;
30. cancel during SSH execution and during provider streaming;
31. attempt to use the compute-grant owner's personal Codex auth from another
    collaborator account and confirm denial;
32. connect two subscription profiles to one CoCalc account and alternate
    explicit runs without credential overwrite;
33. exercise automatic profile selection as rate-limit status changes;
34. revoke one profile and verify the other remains usable;
35. verify compute cost and model usage have distinct attribution.
36. fill an attached ext4 volume close to capacity and grow it online;
37. disconnect the initiating SSH and ACP sessions during a durable build,
    reconnect, and verify logs and final exit status;
38. lose the provider resize response and verify reconciliation adopts the
    actual larger disk without a second growth or incorrect charge;
39. replace the VM, reattach the volume, and verify Docker layers, compiler
    caches, and durable job evidence survived;
40. attempt agent resize beyond per-volume, aggregate-GiB, and monthly-cost
    limits and confirm transactional rejection.
41. generate repeated native core dumps and prove the configured quota keeps
    the disposable root filesystem below its safety threshold while retaining
    any requested bounded evidence under `/work`.

### Adversarial tests

As root inside the VM, attempt to:

- request metadata service-account tokens;
- access project-wide SSH metadata;
- change the GCP firewall;
- enable Tier 1 networking;
- attach another disk;
- reach another agent VM;
- reach project hosts or hubs over private IP;
- evade metrics with Docker, VPN, encryption, raw sockets, and multiple NIC
  namespaces;
- keep the VM running after TTL;
- detach or delete the provider disk through GCP APIs;
- locate or exfiltrate `auth.json`, API keys, access tokens, a general CoCalc
  bearer, or SSH private keys;
- forge `session_id`, `lastTurnId`, `run_id`, and `vm_id` across accounts and
  projects;
- return malicious output asking the coordinator to override policy, allocate
  more compute, change payment source, or reveal hidden context;
- expose port 443.

The expected result is either denial outside the guest or harmless compromise
of only that guest and its attached user volume.

## Rollout

1. Keep the site setting disabled by default.
2. Deploy schema and read-only APIs.
3. Validate the isolated staging project.
4. Enable site-funded use for administrators on staging.
5. Run the full staging test plan and retain evidence.
6. Enable one administrator production canary after explicit approval.
7. Verify billing, TTL, volume persistence, and egress for at least several
   days.
8. Review the then-current Codex auth/automation guidance, contact OpenAI about
   App Server known-client/compliance registration, and record the approved
   auth/placement matrix.
9. Canary fresh, fork-through-turn, resume, and four-way fan-out with no
   provider credential present in any guest.
10. Enable a small administrator allowlist.
11. Add explicit membership-tier configuration with zero defaults.
12. Offer opt-in Pro access only after reviewing abuse, support, and billing
    evidence.

Rollback means:

- stop new grants and creates;
- let active TTL enforcement continue;
- keep volume list/delete available;
- preserve all persistent volumes;
- retain reconciliation until all VMs are gone;
- never disable cleanup merely because product creation is disabled.

## Implementation Sequence By Area

### Database and shared types

- add compute VM, volume, grant, work, and audit schemas;
- add normalized public API types;
- add explicit bay ownership;
- add indexes for owner, project, state, TTL, and work claiming;
- add table ownership declarations.

### Provider and worker

- add narrow GCP compute provider;
- add isolated work queue;
- implement create/status/stop/delete;
- implement disk create/attach/detach/grow/delete;
- add invariant verification;
- add reconciler and expiry worker.

### Auth and API

- add account and project Conat APIs;
- route by owner bay;
- add fresh-auth checks;
- add grant admission transaction;
- register dangerous RPC decisions;
- add audit events and LROs.

### Billing and telemetry

- add fixed-rate compute and volume sessions;
- add Monitoring client and egress accumulator;
- add threshold enforcement;
- add spend maintenance;
- add operator summaries and alerts.

### CLI

- add `compute`, `vm`, and `volume` command modules;
- add volume resize, build-worker bootstrap, and durable job commands;
- add stable JSON output;
- add local SSH key management;
- add direct SSH/exec/cp/rsync;
- add LRO progress and fresh-auth guidance.

### Codex and agent orchestration

- extend ACP fork requests and the App Server bridge with `lastTurnId`;
- add compute-target configuration and durable run links;
- reuse existing account auth resolution, payment-source accounting, session
  storage, quota governor, interrupt, resume, and fork paths;
- add project CLI context modes and JSON request/result contracts;
- add a secretless compute tool/skill using direct SSH commands;
- add bounded fan-out and structured child result manifests;
- add provider-policy placement gates and a kill switch;
- keep the design agent-provider-neutral at the compute boundary even though
  Codex is the first deep integration.

### Frontend

- add settings page type and route;
- add one settings page definition;
- add eligibility visibility;
- add grant, VM, and volume sections;
- reuse existing fresh-auth and purchase UI patterns;
- keep all data-plane actions in CLI.

## Acceptance Criteria

The MVP is complete only when:

- a freshly authenticated human can authorize an agent project with a bounded
  grant;
- the project agent can create an x86 or ARM64 Ubuntu VM and obtain root;
- Docker works normally;
- Docker layers and documented package/compiler caches persist on `/work`
  across VM replacement;
- native crashes cannot accumulate unbounded data on the disposable root, and
  any retained crash evidence is quota-bounded and manifest-recorded;
- the agent can use direct SSH, `scp`, and `rsync`;
- the agent can run and reconcile durable jobs across SSH and coordinator
  disconnects;
- an authenticated Codex account can start a fresh child, fork through a
  specified completed turn, or resume a child against a selected ready VM;
- parallel child runs have independent threads and writable workspaces;
- the compute grant and Codex auth/payment-source envelope are enforced and
  reported independently;
- no Codex subscription credential, API key, access token, general CoCalc
  bearer, or SSH private key is present in the hostile guest;
- VM creation requires fresh human authorization directly or an active bounded
  grant;
- every VM has a hard control-plane TTL;
- VM expiry deletes its disposable boot disk;
- an explicit persistent volume survives VM expiry;
- that volume attaches to exactly one VM;
- an authorized agent can grow that volume online inside a human-set size and
  recurring-cost envelope, while shrink and excess growth are rejected;
- provider resize, ext4 growth, billing, and partial-failure reconciliation
  pass the staging tests;
- volume deletion always requires fresh human authentication;
- no VM has a service account or platform secret;
- no VM has private network access to CoCalc infrastructure;
- only SSH is reachable inbound;
- Standard Tier is enforced;
- bytes sent are metered outside the guest and charged at the published rate;
- egress, fixed-spend, and TTL enforcement work without guest cooperation;
- orphan VMs are stopped and reconciled;
- orphan volumes are preserved;
- `/settings/compute` gives a human complete authorization and emergency
  visibility;
- no website-hosting or transparent project-runtime feature has entered scope.

## Deferred Extensions

Possible later work, each requiring a separate decision:

- snapshots and volume cloning;
- trusted Docker-cached boot images;
- automatic Spot replacement;
- additional providers;
- GPU leases;
- account-owned grants not bound to a project;
- OpenSSH host and user certificates;
- a platform egress gateway with hard byte policing;
- persistent server leases;
- website hosting through a distinct ingress product;
- a transparent SSH-backed remote workspace adapter for all Codex file and
  process tools;
- managed VM-resident Codex runners with a per-run provider proxy;
- enterprise Codex access-token support for explicitly trusted private
  runners;
- provider adapters for agents other than Codex;
- a higher-level fleet scheduler, task graph, automatic merge service, or
  correctness judge above independent child runs.

None of these are prerequisites for the first-release Linux package-building
contract, which includes grow-only volume resize, persistent build caches, and
durable remote jobs.

## Reference Material

- [Scalable control-plane architecture](./scalable-architecture.md)
- [Dedicated-host billing enforcement](./dedicated-host-billing-enforcement-plan-2026-05-09.md)
- [Dedicated-host owner access control](./dedicated-host-owner-access-control-plan-2026-05-11.md)
- [GCP service accounts for Compute Engine](https://docs.cloud.google.com/compute/docs/access/service-accounts)
- [GCP SSH security guidance](https://docs.cloud.google.com/compute/docs/connect/ssh-best-practices/login-access)
- [GCP metadata security](https://docs.cloud.google.com/compute/docs/metadata/overview)
- [GCP VPC firewall rules](https://docs.cloud.google.com/firewall/docs/firewalls)
- [GCP Standard Tier pricing](https://cloud.google.com/network-tiers/pricing)
- [GCP Compute Engine network metrics](https://docs.cloud.google.com/monitoring/api/metrics_gcp_c)
- [Cloud NAT pricing](https://cloud.google.com/nat/pricing)
- [GCP Spot VM behavior](https://docs.cloud.google.com/compute/docs/instances/spot)
- [GCP Spot VM pricing](https://cloud.google.com/spot-vms/pricing)
- [OpenAI Codex pricing and usage limits](https://learn.chatgpt.com/docs/pricing)
- [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth)
- [OpenAI Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenAI Codex remote connections and SSH hosts](https://learn.chatgpt.com/docs/remote-connections)
