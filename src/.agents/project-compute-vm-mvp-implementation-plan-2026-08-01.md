# Project Compute VM MVP Implementation Plan

Date: 2026-08-01

Status: implementation in progress. The staging-admin CLI checkpoint described
below is deployed only to staging; production behavior is unchanged.

Supersedes
[Agent Compute VM Leases And Volumes Plan](./agent-compute-vm-leases-and-volumes-plan-2026-07-29.md).
The earlier document remains useful design history, but it combines VM leases,
storage, exact egress billing, durable jobs, and Codex orchestration into a
scope that is too large for the first product.

## Implementation Checkpoint: 2026-08-02

Commits `0e64194d34`, `15ebf592f9`, `bd29046453`, and `f70f357edc` implement
and harden the staging-admin VM lifecycle slice. The final staging hub artifact
is `20260802T090127Z-f70f357e-compute-vm-cli-f70f357e`.

Implemented now:

- durable VM, provider-generation, work-queue, and audit tables;
- an admin-only, account-owned Conat API with project-membership checks and
  fresh authentication for create and delete;
- `vm create`, `list`, `get`, `wait`, `start`, `stop`, `delete`, `ssh`, and
  `exec` CLI commands;
- a small GCP machine catalog, on-demand and Spot provisioning, a persistent
  named root disk, direct SSH, hard TTL, and explicitly authorized on-demand
  fallback state;
- reuse of the project-host Spot recovery/circuit-breaker policy, including a
  provider probe before disruptive return to Spot;
- guest isolation settings for no service account, blocked project SSH keys,
  no agent forwarding, no IP forwarding, and no deletion protection;
- fixed-cost staging authorization bounded by the hard lease deadline; and
- durable work claims serialized per VM while retaining concurrency between
  VMs.

Staging evidence:

- an on-demand `e2-standard-2` completed create, SSH/exec, stop, restart,
  persistent-root verification, explicit delete, and provider inventory
  cleanup;
- two Spot `e2-standard-2` VMs were provider-confirmed as Spot with
  `instanceTerminationAction=STOP`, `autoDelete=false` roots, no service
  account, and blocked project-wide SSH keys;
- a five-minute Spot lease with fallback accepted a TTL-bounded `$0.01`
  authorization and rejected `$0.001`;
- both Spot VMs were selected for deletion within approximately two seconds of
  their hard deadlines, and both instances and persistent roots disappeared;
- one expiry deletion overlapped a rolling four-worker hub deployment and
  still converged without a leaked provider resource; and
- final hub smoke checks passed for the homepage, static shell, auth shell,
  favicon, and every worker-to-project-host route.

This checkpoint intentionally uses staging's existing `projecthosts` GCP
project and provider credentials. It remains admin-only and unbilled. It does
not yet implement persistent `/work`, customer billing, turn-scoped agent
capabilities, minimal UI, an isolated hostile-guest GCP project/VPC, full
cross-bay routing, or the complete Spot preemption/fallback fault matrix.

## Decision

Build a small GCP-only product that gives a CoCalc user a conventional root VM
attached to one CoCalc project.

The durable product has two user-visible resources:

1. a short-lived account-owned VM lease attached to a project;
2. an optional account-owned persistent volume mounted at `/work`.

A user creates and pays for the VM. Codex and other agents continue running in
the CoCalc project. When a user starts an agent turn, that turn can use the
VMs that satisfy both of these conditions:

- the VM is attached to the current project;
- the initiating user owns the VM.

There is no special remote Codex runtime. There are no Codex thread records,
resident runners, subscription-profile schedulers, or model credentials on the
VM. The agent uses the same SSH-oriented VM interface as a human.

The first release includes automatic Spot recovery and bounded fallback to
on-demand capacity. This is a core availability feature, not a later
extension.

The first release also has a minimal project settings page so users can
discover, create, inspect, connect to, stop, and delete their VMs without first
learning the CLI. The UI is not a remote desktop, terminal, file manager, or
general cloud console.

## Product Goal

The product should make this workflow ordinary:

1. A user opens a CoCalc project and creates a VM with a machine type, zone,
   pricing preference, TTL, and optional persistent volume.
2. CoCalc shows an immutable price snapshot and worst-case authorized cost.
3. The VM becomes SSH-ready with root access and a stock Ubuntu environment.
4. The user can connect from a laptop or the CoCalc project.
5. An agent turn started by that user can discover and use the same VM.
6. The user or agent installs packages, runs Docker, and uses `tmux`, systemd,
   or another ordinary Unix tool for work that must survive an SSH disconnect.
7. Spot interruption causes automatic VM recovery, preserving the root disk,
   `/work`, and the original lease deadline.
8. The VM stops and is deleted at its deadline even if every client is
   disconnected.
9. The persistent volume remains until its owner explicitly deletes it.

Representative commands:

```bash
# Human lifecycle operations.
cocalc vm create \
  --project "$PROJECT_ID" \
  --name build-1 \
  --zone us-central1-a \
  --machine t2d-standard-16 \
  --spot \
  --allow-on-demand-fallback \
  --ttl 8h \
  --volume build-cache

cocalc vm list --project "$PROJECT_ID"
cocalc vm wait build-1
cocalc vm ssh build-1
cocalc vm stop build-1
cocalc vm start build-1
cocalc vm delete build-1

# Human or agent data-plane operations.
cocalc vm exec build-1 -- bash -lc 'cd /work && make test'
cocalc vm cp ./src build-1:/work/src
cocalc vm rsync build-1:/work/dist/ ./dist/
```

These commands are a proposed contract, not current behavior.

## Scope

### Included in the MVP

- GCP as the only provider;
- Ubuntu 24.04 LTS x86-64 and ARM64 images;
- a small explicit machine-type catalog;
- Spot and on-demand pricing;
- automatic Spot restart and bounded on-demand fallback;
- persistent VM-owned boot disks that survive stop, start, and Spot recovery;
- at most one persistent zonal `pd-balanced` volume per VM;
- one read-write ext4 mount at `/work`;
- grow-only volume resize;
- direct SSH, command execution, `scp`, and `rsync`;
- human lifecycle management through CLI and minimal UI;
- short-lived agent-turn authority for use of existing VMs;
- hard VM TTL and cost authorization;
- durable provider work, reconciliation, audit, and orphan handling;
- staging fault injection and actual provider canaries;
- an allowlisted production beta before broad availability.

### Explicitly deferred

- durable remote-job records or a job scheduler;
- Codex-specific compute runs, thread forks, or context management;
- VM-resident Codex or ACP workers;
- subscription-profile pooling or scheduling;
- unbounded agent spending or lifecycle authority without a durable spend
  envelope or explicit user approval;
- more than one attached volume;
- volume snapshots, cloning, shrinking, backups, or cross-zone migration;
- automatic project file synchronization or remote mounts;
- browser terminals, file browsers, Jupyter kernels, and editor execution;
- public ports other than SSH;
- website hosting, DNS, TLS, custom domains, and Cloudflare routes;
- static IP addresses;
- custom images, GPUs, Windows, and providers other than GCP;
- idle detection and automatic idle shutdown;
- a general collaborator ACL for VMs;
- exact egress product billing in the first allowlisted canary.

`tmux`, `screen`, `systemd-run`, Docker restart policies, and other normal Unix
tools are sufficient for durable work in the MVP. CoCalc must not build a
second job-control system unless real usage demonstrates a missing primitive.

## Core Invariants

### Ownership and project attachment

Every VM and volume has one permanent `owner_account_id` and one explicit
`owning_bay_id`. A VM also has a required `project_id`.

- The account owner is responsible for cost and destructive decisions.
- The owner's home bay at creation is authoritative for VM and volume control
  records.
- Cross-bay callers route to that authority using the normal inter-bay layer.
- The project attachment controls discovery and agent-turn use; it does not
  transfer ownership to the project or its collaborators.
- A project move does not move a GCP VM or zonal disk.
- Project deletion stops and deletes active VM leases promptly but preserves
  persistent volumes for their account owner.
- Account rehoming moves control metadata through an explicit administrative
  process; it does not recreate provider resources.

The UI shows only the current user's VMs by default. A collaborator does not
gain access merely because the VM is attached to a shared project.

### Control plane and data plane

The control plane performs:

- authentication and authorization;
- admission and immutable price authorization;
- provider lifecycle operations;
- TTL enforcement;
- Spot recovery;
- volume attachment fencing;
- reconciliation and audit.

Steady-state commands and file transfer flow directly between the project or
laptop and the VM over SSH. The hub does not proxy terminal, file, Docker, or
build traffic.

### Hostile guest

Treat the VM guest as hostile. Root can modify the guest, disable services,
forge guest telemetry, fill disks, and persist arbitrary content on `/work`.

No authorization, lifecycle, billing, or expiration decision may depend on
guest cooperation. The VM receives no:

- GCP service account or OAuth scopes;
- CoCalc bearer tokens, API keys, or fresh-auth cookies;
- Conat, database, object-storage, or Cloudflare credentials;
- provider credentials;
- Codex or model-provider credentials;
- operator private keys.

## Isolated GCP Foundation

Run user VMs in a GCP project dedicated to untrusted compute. It must have:

- a dedicated VPC;
- no Shared VPC, peering, VPN, or private route to CoCalc infrastructure;
- no useful default service account;
- explicit quotas and mandatory resource labels;
- centrally managed ingress and egress firewall rules;
- separate trusted control-plane provider credentials.

Each VM must explicitly set and later verify:

- no service account and no OAuth scopes;
- `canIpForward = false`;
- project-wide SSH keys blocked;
- no deletion protection;
- Standard Tier networking;
- one ephemeral external IPv4 address;
- no external IPv6;
- only TCP 22 permitted inbound;
- no east-west VM traffic;
- no route to protected CoCalc or private address ranges.

The control plane quarantines and deletes a VM whose observed security
configuration violates these invariants. Do not rely on provider defaults.

The guest may make outbound Internet connections. Before broad customer
availability, CoCalc must bound the resulting egress exposure independently
of the guest. The allowlisted beta may precede exact egress billing only with:

- low per-account VM and vCPU limits;
- short maximum TTL;
- provider-project quotas;
- aggregate network-cost monitoring;
- an operator-visible emergency global stop;
- an explicit allowlist of trusted accounts.

Exact per-VM egress metering, charging, and shutdown remains a separate GA
gate. It must not block implementation and testing with administrators and a
small trusted beta.

## Authorization Model

### Human lifecycle authority

The following actions require browser-backed fresh authentication:

- create a VM;
- increase TTL or authorized cost;
- enable or increase on-demand fallback;
- create, grow, attach, detach, or delete a persistent volume;
- permanently delete a VM lease when data-loss consequences are possible.

Ordinary authenticated account authority is sufficient to:

- list and inspect owned VMs;
- obtain an SSH connection command;
- stop an owned VM;
- restart an owned VM inside its existing TTL and cost envelope;
- request idempotent deletion when no persistent resource is deleted.

Creation performs one atomic admission transaction. It verifies account
eligibility, project membership, site limits, machine allowlist, provider
quota, funding, TTL, fixed-cost authorization, fallback authorization, and
volume ownership before inserting the durable lease and provider work.

There is no general `compute_grants` resource in the MVP. Each human-created VM
row contains its own immutable authorization envelope. This removes an entire
grant lifecycle and prevents an agent from silently provisioning additional
spend.

### Agent-turn authority

When ACP starts a turn, the trusted project-side service requests a short-lived
compute capability bound to:

- initiating `account_id`;
- current `project_id`;
- turn or session identifier;
- expiration no later than the turn authority;
- scopes and a durable spend envelope no broader than the initiating user's
  explicit authorization.

The capability permits the turn to use existing resources and, within a
durable authorization envelope, perform lifecycle mutations on behalf of the
initiating user. It may:

- list VMs owned by that account and attached to that project;
- inspect state and wait for readiness;
- obtain short-lived SSH access;
- run commands and transfer files over direct SSH.
- create and delete VMs and volumes;
- start, stop, and resize VMs;
- extend TTL, enable fallback, and grow storage;
- alter billing choices that remain inside the approved envelope.

Every spend-increasing mutation must either fit inside a durable per-turn or
per-request authorization envelope or pause for explicit user approval. The
envelope includes maximum hourly cost, maximum total cost, expiration, allowed
machine/storage classes, fallback limits, and an idempotency scope. It never
permits access to another account's VM. Agent authority is intentionally the
same lifecycle API as human authority with a narrower actor-bound budget, not
a second compute orchestration system.

Do not write a reusable account token or permanent private key into the shared
project filesystem. The preferred access design is:

1. the turn creates an ephemeral SSH key pair in its private runtime state;
2. the control plane validates the scoped capability and signs the public key
   with a dedicated compute SSH user CA;
3. the VM trusts only that CA for the `root` principal in addition to any
   explicitly configured human key;
4. the certificate expires shortly after the turn authority;
5. direct SSH uses the ephemeral key and certificate.

The VM receives only the CA public key. The CA private key remains in trusted
control-plane secret storage. Human CLI access may use the same short-lived
certificate flow.

Root can deliberately install another key after access is granted. Therefore
certificate expiry limits what CoCalc issues; it cannot revoke persistence
created by the VM owner inside a hostile guest. The product must state this
honestly.

## Resource Model

Use top-level columns for fields needed by authorization, reconciliation,
billing, and list views. Provider diagnostics and non-authoritative details may
use JSON metadata.

### `compute_vms`

Required logical fields:

- `id`, `name`;
- `owner_account_id`, `owning_bay_id`, `project_id`;
- `provider`;
- `region`, `zone`, `architecture`, `machine_type`;
- `desired_pricing_model`, `effective_pricing_model`;
- `boot_disk_gb`;
- `state`, `desired_state`;
- `instance_generation`;
- current provider instance ID, persistent boot disk ID, and public IP;
- optional `attached_volume_id`;
- `created_at`, `ready_at`, `expires_at`, `stopped_at`, `deleted_at`;
- immutable Spot and on-demand hourly price snapshots;
- `allow_on_demand_fallback`;
- authorized on-demand fallback hours and maximum total fixed cost;
- accrued fixed cost and billing state;
- normalized Spot recovery policy and state;
- latest bounded error and metadata.

Suggested logical states:

```text
requested
provisioning
starting
ready
stopping
stopped
recovering
deleting
deleted
failed
```

Suggested desired states:

```text
running
stopped
deleted
```

`ready` refers to the current provider generation. The logical VM lease can
remain `recovering` while one generation has been preempted and another is
being created.

### `compute_vm_instances`

Record each provider generation separately:

- logical VM ID and monotonically increasing generation;
- provider instance ID and operation IDs;
- machine type and effective pricing model;
- public IP;
- created, running, ready, preempted, stopped, and deleted timestamps;
- immutable hourly price;
- provider-confirmed interruption identity;
- terminal reason and diagnostics.

This table makes replacement history, billing, deduplication, and incident
analysis explicit. Never overwrite the only evidence of a preempted provider
instance when creating its replacement.

### `compute_volumes`

Required fields:

- `id`, `name`;
- `owner_account_id`, `owning_bay_id`;
- provider disk ID;
- region, zone, type, filesystem;
- current and desired size;
- state and attached logical VM ID;
- attachment generation and fencing state;
- created, ready, resized, detached, and deleted timestamps;
- immutable storage price snapshot and billing state;
- latest bounded error and metadata.

MVP constraints:

- GCP zonal `pd-balanced` only;
- ext4 only;
- fixed mount point `/work`;
- one read-write attachment;
- grow-only resize;
- no snapshot, clone, shrink, or cross-zone move;
- explicit fresh-auth deletion with typed confirmation.

### Work and audit

Use a separate durable `compute_resource_work` queue. Do not reuse
project-host `cloud_vm_work` or route through `host-work.ts`; those paths carry
project-host bootstrap, DNS, placement, rootfs, and health assumptions.

Each work item has resource kind, resource ID, action, idempotency key, payload,
state, attempt, `not_before`, lock owner/time, timestamps, provider operation
ID, and bounded error.

Every mutation appends an audit event with actor, owner, project, resource,
action, request and idempotency IDs, fresh-auth decision, authorization and
price snapshots, old/new states, provider operation ID, and result. Never log
private keys, certificates, cookies, or provider credentials.

## VM Lifecycle

### Create

1. Resolve account and project ownership authority.
2. Perform fresh-auth, funding, catalog, TTL, fallback, and volume admission.
3. Snapshot all relevant prices and the maximum authorized fixed cost.
4. Insert the logical VM and first provider generation transactionally.
5. Fence the optional volume for this logical VM.
6. Enqueue idempotent provider creation.
7. Create the VM with mandatory labels and security settings.
8. Attach the optional volume.
9. Verify provider security invariants.
10. Wait for TCP 22 and verify SSH readiness.
11. Verify `/work` is mounted when requested.
12. Publish the provider generation as ready.

The API returns a long-running operation immediately. CLI and UI may wait and
show structured progress.

### Stop and start

Stopping uses the provider API and preserves the logical lease, persistent
VM-owned boot disk, and persistent volume. Starting is allowed only
before `expires_at` and inside the existing cost envelope.

An agent can run `shutdown` as root, but provider state and billing remain
authoritative. Reconciliation updates the logical state when guest-initiated
shutdown is observed.

### Expiration and deletion

TTL is enforced outside the guest:

1. set desired state to `deleted` at expiration;
2. stop the provider instance;
3. detach the persistent volume safely;
4. delete the instance and its VM-owned persistent boot disk;
5. finalize fixed-cost accounting;
6. preserve the volume;
7. mark the logical lease deleted.

Deletion is idempotent. It must never delete the persistent volume implicitly.

## Spot Recovery

### Shared policy, separate orchestration

Extract the pure policy in `packages/server/cloud/spot-restore.ts` into
resource-neutral types and functions. Keep compatibility wrappers for project
hosts. Reuse the policy and its tests for compute VMs, but implement provider
work in the separate compute reconciler.

Default policy:

- retry interrupted Spot capacity promptly with exponential backoff;
- try the configured compatible machine types in order;
- use at most two failed Spot restore attempts before on-demand fallback;
- treat two provider-confirmed preemptions within four hours as rapid
  preemption;
- hold on-demand fallback for up to 24 hours after rapid preemption;
- probe Spot capacity separately before considering a return;
- deduplicate repeated observations of the same provider interruption.

All replacement candidates must:

- remain in the volume's zone when a volume is attached;
- use the same architecture;
- remain within approved CPU, RAM, and hourly-cost bounds;
- preserve the logical VM ID and original `expires_at`;
- increment provider `instance_generation`;
- receive no additional spending authority.

### Recovery sequence

1. Provider-confirmed interruption marks the current generation terminal.
2. The logical lease enters `recovering` if desired state remains `running`.
3. Retry compatible Spot capacity according to the policy.
4. If retries fail, use on-demand only when explicitly authorized and funded.
5. Attach the fenced persistent volume to the replacement.
6. Publish the new IP and generation only after SSH and mount readiness.
7. Leave the logical VM in a clear failed/interrupted state if no authorized
   replacement is possible.

Automatic recovery restores the VM primitive using the same VM-owned boot
disk, but not the lost process tree. Root filesystem contents therefore
survive Spot recovery. Users and agents should still use ordinary restart
scripts or service definitions when automatic workload resumption matters,
and keep independently durable artifacts on `/work` when requested.

### Safe return from on-demand

Compute VMs use exactly the project-host return policy. After the bounded
on-demand hold, the control plane probes Spot capacity and disruptively returns
the VM to Spot after a successful probe. Selecting Spot is an explicit contract
that the workload tolerates interruption; workloads that cannot tolerate this
must use on-demand pricing. The UI and CLI must state this rather than adding a
second, non-disruptive Spot policy.

## Persistent Volume Lifecycle

### Create

Creation requires fresh auth, funding admission, zone/type/size validation,
and a recurring-cost confirmation. Insert the durable row before provider
work. Format ext4 only after proving the disk is new and unformatted.

### Attach and detach

The database attachment reservation and generation are authoritative for
admission. Provider state is authoritative for physical attachment.

- reserve the volume transactionally before provider attach;
- reject a second writer;
- verify provider attachment and expected device identity;
- mount only at `/work`;
- use `attachment_unknown` when provider state cannot be proved;
- never attach elsewhere while state is unknown;
- detach before replacing a provider instance;
- require operator repair when safe ownership cannot be established.

### Resize

Resize is grow-only and fresh-auth protected. Persist desired size before
provider work, make provider growth idempotent, and track provider growth
separately from filesystem growth. Provider size is authoritative for billing
even if ext4 growth is pending.

### Delete

Deletion requires fresh auth and typed confirmation. Refuse deletion while an
attachment is known or uncertain. Provider deletion must be confirmed before
marking the volume deleted.

## Provider Implementation

Create a sibling server subsystem rather than extending project hosts:

```text
packages/server/compute/
  api.ts
  auth.ts
  billing.ts
  catalog.ts
  lifecycle.ts
  reconcile.ts
  ssh.ts
  spot-recovery.ts
  volumes.ts
  worker.ts
  providers/
    gcp.ts
```

The GCP provider adapter must support idempotent:

- create, inspect, stop, start, and delete VM;
- list labeled resources;
- create, inspect, attach, detach, grow, and delete disk;
- inspect operation state;
- verify instance security invariants;
- obtain network usage needed for later egress enforcement.

Use immutable labels containing environment, logical VM or volume ID, owner
hash, and provider generation. Provider timeouts must always be resolved by
inspection before retrying creation.

Start with a small versioned catalog, for example selected `t2d`, `n2d`, and
`t2a` types. Do not expose arbitrary custom machine definitions. Catalog
entries include architecture, vCPU, RAM, supported pricing models, compatible
Spot alternatives, regional availability, and current immutable price
snapshots used at admission.

Use a pinned Ubuntu 24.04 LTS image. Bootstrap only what the platform contract
requires:

- SSH CA trust and hardened sshd settings;
- password authentication disabled;
- optional `/work` discovery and mount;
- bounded crash-dump defaults;
- non-secret lease diagnostics.

Do not install a trusted guest control agent. Docker may be installed by the
user or agent. A later secret-free image with Docker preinstalled is only a
startup optimization.

## API and CLI

Prefer Conat RPC with explicit account-home-bay routing. Separate human
lifecycle mutations from short-lived turn-use methods.

Human API surface:

- `createComputeVm`;
- `listComputeVms`;
- `getComputeVm`;
- `startComputeVm`;
- `stopComputeVm`;
- `deleteComputeVm`;
- `createComputeVolume`;
- `listComputeVolumes`;
- `resizeComputeVolume`;
- `deleteComputeVolume`;
- `attachComputeVolume`;
- `detachComputeVolume`.

Turn-use API surface:

- `listUsableComputeVms`;
- `getUsableComputeVm`;
- `issueComputeSshCertificate`.

Every mutation accepts an idempotency key. Long provider operations return an
operation ID and structured stages. CLI waits must be interruptible without
cancelling the durable operation.

CLI commands:

```text
cocalc vm create|list|get|wait|start|stop|delete
cocalc vm ssh|exec|cp|rsync
cocalc volume create|list|get|resize|attach|detach|delete
```

`ssh`, `exec`, `cp`, and `rsync` use ordinary OpenSSH binaries so configuration,
agent forwarding policy, exit codes, signals, and transfer behavior remain
familiar. Disable SSH agent forwarding by default.

## Minimal UI

Add a `Compute VMs` leaf to project settings. Hide it when the site disables
managed compute or the current account is ineligible.

The page contains one compact VM list with:

- name and short ID;
- state and structured progress;
- machine type, architecture, and zone;
- Spot/on-demand desired and effective state;
- fallback or recovery status;
- public IP;
- remaining TTL;
- hourly price and estimated accrued/maximum cost;
- attached volume;
- copyable `cocalc vm ssh <name>` command;
- create, start, stop, and delete actions.

The create dialog contains only:

- name;
- region/zone;
- machine type;
- Spot preference and on-demand fallback authorization;
- TTL;
- optional existing or new `/work` volume;
- immutable price summary and maximum authorized cost.

An advanced disclosure may show boot-disk size, compatible fallback machine
types, and disruptive return-to-Spot policy. Safe defaults should require no
advanced choices.

The volume section shows name, zone, size, attachment, hourly/monthly estimate,
and create, grow, attach, detach, and delete actions.

Do not add:

- an embedded terminal;
- file or package management;
- VM logs beyond bounded lifecycle diagnostics;
- public port, firewall, DNS, or TLS controls;
- snapshots or image building;
- a collaborator ACL;
- a durable jobs UI;
- Codex-specific controls.

The page explains that the VM-owned root disk and `/work` are persistent, a
Spot recovery restarts the VM but not its processes, and persistent storage
continues to incur cost while detached.

## Reconciliation and Failure Safety

The trusted reconciler periodically:

- expires overdue logical leases;
- repairs stale desired/current state;
- resumes abandoned durable work after lock expiry;
- lists labeled provider VMs and disks;
- matches provider generations to durable rows;
- verifies mandatory security invariants;
- detects and deduplicates Spot interruptions;
- advances authorized recovery and fallback;
- verifies one-writer volume attachment;
- stops orphan VMs quickly;
- preserves orphan disks for operator review;
- finalizes fixed-cost accounting;
- reports provider quota and aggregate exposure.

Failure rules:

- Never create a second provider resource after a timeout without inspecting
  labels and operation IDs.
- Never attach a volume while another attachment or uncertain attachment may
  exist.
- Never delete an orphan volume automatically.
- Never extend TTL or fallback spend during recovery.
- Never infer successful workload completion from VM state.
- Never trust guest shutdown or guest-reported accounting.
- Direct SSH continues while the control plane is restarting.

## Billing and Cost Boundaries

At VM creation, snapshot:

- Spot hourly price;
- on-demand hourly price;
- boot-disk price;
- attached-volume price;
- maximum lease duration;
- maximum authorized fallback duration;
- maximum fixed compute cost.

Provider generation intervals determine fixed compute cost. Reconciliation
closes stale intervals using provider-observed state. Starting or replacing a
VM is rejected when the remaining envelope cannot cover the minimum useful
interval.

The customer authorization snapshot is a maximum charge, not permission for
CoCalc to absorb unlimited provider price drift. Before every start, recovery,
or fallback transition, refresh the provider estimate and compare it with both
the customer's remaining envelope and a configured platform subsidy ceiling.
If the estimate exceeds either bound, do not start a new provider generation;
stop at the next safe boundary and require a new explicit authorization.
Short beta TTLs, per-account quotas, and an aggregate provider-project budget
provide independent exposure bounds if price data is delayed or unavailable.

Volumes have independent recurring storage billing and remain billable while
detached. Their UI must show both hourly and approximate monthly cost.

For the allowlisted beta, publish that network transfer may be restricted and
monitor aggregate provider cost. Before general availability, add per-VM
host-level egress measurement, delayed-metric exposure bounds, customer
pricing, enforcement, and final reconciliation as a separately reviewed
change set.

## Observability

Operator status should include:

- active logical VMs and provider generations by zone and pricing model;
- provisioning and SSH-readiness latency;
- active vCPU, RAM, boot-disk, and volume totals;
- VMs nearing expiration or fallback limits;
- Spot interruptions, retries, fallbacks, probes, and recovery latency;
- queue age, retries, and terminal failures;
- orphan and security-invariant violations;
- attachment-unknown volumes;
- authorized versus accrued fixed cost;
- provider quota and aggregate network-cost exposure.

Page only on actionable platform failures such as an expired VM still running,
an unexpected service account, forbidden network configuration, an orphan VM,
an unknown/multiple disk attachment, or failure to stop spend. Expected Spot
interruption followed by successful recovery is an event, not a page.

## Implementation Phases

### Phase 0: narrow contracts and isolated foundation

- finalize schema, states, catalog, and pricing envelope;
- extract resource-neutral Spot policy without changing project-host behavior;
- provision the dedicated GCP project, VPC, firewall, IAM, and quotas;
- create separate staging/production credentials and emergency controls;
- threat-model SSH CA custody, provider labels, and cross-bay routing;
- infrastructure has no route or credential path to trusted CoCalc services;
- project-host Spot tests remain unchanged and pass through compatibility
  wrappers.

### Phase 1: admin CLI VM lease

- add VM, provider-generation, work, and audit schema;
- implement GCP create/inspect/stop/start/delete;
- implement TTL, fixed-cost admission, idempotency, and orphan reconciliation;
- implement SSH readiness and short-lived certificate issuance;
- expose admin-only CLI lifecycle and SSH commands on staging;
- repeated create/delete and injected timeout tests create no duplicates;
- TTL and worker-restart tests lose no work and leak no VM;
- root in a VM cannot reach trusted private services or obtain credentials.

### Phase 2: persistent `/work`

- add volume schema and provider operations;
- implement attachment fencing and uncertain-state repair;
- implement idempotent ext4 creation, mount verification, and grow-only resize;
- add volume billing and orphan preservation.
- prove one-writer safety across worker crashes and provider timeouts;
- prove replacement never formats an existing disk and `/work` survives;
- prove VM deletion never deletes the volume.

### Phase 3: automatic Spot recovery

- connect the shared policy to compute provider generations;
- implement compatible Spot retries and alternate types;
- implement explicitly authorized on-demand fallback;
- implement provider-confirmed preemption deduplication;
- implement the project-host-compatible disruptive return after a successful
  Spot probe;
- prove with fault injection and an actual Spot canary that recovery stays
  inside the original TTL/cost envelope, preserves the root disk and `/work`,
  counts each event once, and follows the project-host return policy.

### Phase 4: project and agent access

- add account-home-bay routed Conat APIs;
- add turn-scoped compute capability issuance;
- add ephemeral key and SSH certificate flow;
- expose VM commands to project-side agents without Codex-specific state;
- prove that expired, forged, cross-account, and cross-project capabilities
  fail and that no durable credential is written to project files.

### Phase 5: minimal UI

- add the project settings VM list and create dialog;
- add compact volume controls;
- show price, TTL, SSH command, recovery, and persistent-root semantics;
- verify discovery and lifecycle management without CLI setup while adding no
  terminal, file manager, job system, or cloud-console scope.

### Phase 6: staging stress and production canary

- run concurrent create/start/stop/delete and volume attach/detach tests;
- restart workers during every provider operation;
- inject provider timeouts, stale reads, preemptions, and quota failures;
- fill root disks and verify recovery and `/work` remain safe;
- test project deletion and account/project cross-bay routing;
- run long computations through Spot fallback and safe return behavior;
- canary with administrators, then selected trusted paid accounts;
- require no leaked VM, duplicate instance, double attachment, lost volume,
  overspend, or cross-account access, plus a successful real preemption and
  guest-independent emergency stop.

### Phase 7: general-availability gate

Before removing the allowlist:

- implement and review bounded per-VM egress metering and enforcement;
- define membership/account limits and abuse response;
- validate provider quota and regional capacity strategy;
- document support and data-loss expectations;
- complete a production canary with real billing reconciliation.

## Test Matrix

- Unit tests cover lifecycle transitions, cost envelopes, TTL, Spot policy and
  deduplication, compatible machine selection, work idempotency, attachment
  fencing, resize state, authorization, fresh auth, and schema ownership.
- Staging tests cover every architecture/pricing mode; SSH/exec/copy; stop and
  start; `/work` persistence; forced preemption and fallback; safe return;
  provider timeout and worker restart; unattended expiry; project deletion;
  adversarial account/project/turn access; hostile-root network inspection;
  orphan handling; and emergency stop.
- Production canaries require provider/database inventory agreement, correct
  cost intervals, no stale work or unknown attachments, explainable recovery,
  acceptable readiness latency, bounded aggregate egress exposure, and no
  measurable project-host impact.

## Rollout

1. Keep all site and membership limits disabled by default.
2. Deploy schema and dormant worker code.
3. Enable staging administrators only.
4. Complete the full staging fault matrix.
5. Enable one production administrator with low quotas and short TTLs.
6. Observe provider inventory, cost, recovery, and orphan reconciliation.
7. Expand to the remaining administrators.
8. Add a small allowlist of trusted paid customers.
9. Complete the egress GA gate before broad membership enablement.

Rollback disables new creation first. Existing leases continue to be governed
by the durable reconciler until stopped and deleted; disabling the UI or API
must never disable TTL enforcement. Persistent volumes remain visible and
deletable after VM creation is disabled.

## Acceptance Criteria

The MVP is complete when:

- a freshly authenticated user can create a bounded VM attached to a project;
- the user can discover it in a minimal project UI and connect over SSH;
- an agent turn can use only that user's VMs in the current project;
- no Codex process or credential runs on or enters the VM;
- a persistent `/work` volume survives stop/start and provider replacement;
- Spot interruption automatically restores authorized capacity;
- fallback stays inside the original envelope and does not kill healthy work;
- expiration, billing safety, and orphan cleanup work without guest
  cooperation;
- project deletion stops compute but does not destroy persistent volumes;
- cross-account and cross-project access is rejected;
- provider faults and worker restarts create no duplicate resources;
- the production beta has actionable status and an emergency stop;
- broad release remains blocked until egress exposure is independently bounded.

Anything beyond these criteria is a follow-up product, not unfinished MVP
work.
