# Agent Compute VM Leases And Volumes Plan

Date: 2026-07-29

Status: proposed implementation plan; this document does not change runtime or
production behavior.

## Executive Decision

Build a deliberately small GCP-only compute product for AI agents:

- a **VM lease** is short-lived root compute with Docker-capable Ubuntu;
- a **volume** is explicitly created persistent storage;
- a volume can be attached read-write to exactly one VM lease;
- the VM boot disk is disposable and deleted with the lease;
- a human uses fresh authentication to issue a bounded compute grant;
- an agent can act only inside that grant;
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
  --allow-volume sage-pypy

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
- running many independent temporary build or migration workers;
- connecting from a CoCalc project with standard SSH, `scp`, and `rsync`;
- connecting from a user's laptop with the same standard tools;
- letting an AI agent provision compute only after explicit human approval;
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
  max_vm_ttl_seconds INTEGER NOT NULL,
  max_fixed_cost_usd NUMERIC NOT NULL,
  max_egress_gib NUMERIC NOT NULL,
  allowed_architectures TEXT[] NOT NULL,
  allowed_machine_types TEXT[] NOT NULL,
  allowed_pricing_models TEXT[] NOT NULL,
  allowed_volume_ids UUID[] NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'
);
```

The exact schema can use normalized grant-volume rows if query or update
requirements make arrays awkward. The first implementation should prefer the
smallest representation that supports transactional envelope checks.

A grant is:

- issued only after browser-backed fresh authentication;
- bound to one owner and one project;
- short-lived;
- revocable;
- unable to create volumes;
- unable to delete volumes;
- unable to expand its own limits;
- usable only for VM operations within its stored envelope.

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
  filesystem TEXT NOT NULL DEFAULT 'ext4',
  state TEXT NOT NULL,
  attached_vm_id UUID,
  attachment_generation BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  ready_at TIMESTAMPTZ,
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
- creation at a fixed size;
- one ext4 filesystem;
- one read-write attachment;
- mount at the fixed path `/work`;
- explicit deletion.

Do not implement shrink, snapshot, clone, or cross-zone move.
Do not make the mount path configurable in MVP.

Online enlargement is useful but may be deferred until after the first
end-to-end release. If added, it must be grow-only and freshly authenticated.

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
- inspect allowed volume names and attachment state.

The agent may not:

- create or delete a volume;
- attach a volume not named by the grant;
- operate another project's VM;
- spend beyond the grant;
- extend the grant;
- open a public port;
- access account or payment credentials;
- obtain fresh-auth session material.

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

Only after this transaction records a VM and reserves grant capacity should it
enqueue provider work.

Provider failure releases the reservation transactionally and records an audit
event.

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
  --max-vm-ttl 4h \
  --arch amd64,arm64 \
  --pricing spot,on-demand \
  --allow-volume sage-pypy

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
cocalc volume delete sage-pypy
```

Creation prints:

- zone permanence;
- hourly price;
- approximate 30-day price;
- the fact that billing continues while detached;
- the fact that VM TTL never deletes the volume.

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
- create and delete actions.

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
- freshly authenticated create/delete;
- zonal `pd-balanced`;
- attach generation and fencing;
- mount at `/work`;
- detach and preserve on VM expiry;
- continuous volume billing record;
- CLI volume commands.

Exit criteria:

- write a checksum-protected workspace;
- delete the first VM;
- attach the same volume to a new VM;
- verify all data;
- prove concurrent attachment is rejected;
- prove VM TTL never deletes the volume.

### Phase 3: compute grants and agent authority

Deliver:

- `compute_grants`;
- fresh-auth issuance and revocation;
- project-bound envelope;
- transactional admission;
- dangerous RPC registry coverage;
- project-scoped CLI create inside grant;
- no general account credential in the project.

Exit criteria:

- a project bearer cannot create a VM without a grant;
- a human can authorize a bounded grant;
- the project can create only inside the envelope;
- grant expiration and revocation block new work;
- the project cannot create or delete volumes.

Phases 2 and 3 may be swapped during implementation, but both are required
before non-admin agent use.

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
- no-service-account request construction;
- Standard Tier and IPv4-only request construction;
- forbidden metadata keys;
- volume attachment generation;
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
25. verify existing SSH continues but new VM operations stop.

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
8. Enable a small administrator allowlist.
9. Add explicit membership-tier configuration with zero defaults.
10. Offer opt-in Pro access only after reviewing abuse, support, and billing
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
- implement disk create/attach/detach/delete;
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
- add stable JSON output;
- add local SSH key management;
- add direct SSH/exec/cp/rsync;
- add LRO progress and fresh-auth guidance.

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
- the agent can use direct SSH, `scp`, and `rsync`;
- VM creation requires fresh human authorization directly or an active bounded
  grant;
- every VM has a hard control-plane TTL;
- VM expiry deletes its disposable boot disk;
- an explicit persistent volume survives VM expiry;
- that volume attaches to exactly one VM;
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
- grow-only volume resize;
- trusted Docker-cached boot images;
- automatic Spot replacement;
- additional providers;
- GPU leases;
- account-owned grants not bound to a project;
- OpenSSH host and user certificates;
- a platform egress gateway with hard byte policing;
- persistent server leases;
- website hosting through a distinct ingress product.

None of these are prerequisites for solving the immediate "an agent just needs
a root VM with persistent work storage" problem.

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
