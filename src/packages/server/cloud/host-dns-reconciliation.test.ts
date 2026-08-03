/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { upsertProjectHost } from "@cocalc/database/postgres/project-hosts";
import { after, before, getPool } from "@cocalc/server/test";

const getProviderContextMock = jest.fn();
const ensureHostDnsMock = jest.fn();
const inspectHostDnsMock = jest.fn();
const adminAlertMock = jest.fn();

jest.mock("./provider-context", () => ({
  getProviderContext: (...args: any[]) => getProviderContextMock(...args),
}));

jest.mock("./dns", () => ({
  ensureHostDns: (...args: any[]) => ensureHostDnsMock(...args),
  inspectHostDns: (...args: any[]) => inspectHostDnsMock(...args),
}));

jest.mock("@cocalc/server/messages/admin-alert", () => ({
  __esModule: true,
  default: (...args: any[]) => adminAlertMock(...args),
}));

const HOST_ID = "6caa543b-b479-472b-8565-3f55bd699cd9";
const OLD_IP = "203.0.113.10";
const NEW_IP = "203.0.113.20";
const DNS_NAME = `host-${HOST_ID}-test.example.com`;

async function addDirectHost(id: string, name: string): Promise<void> {
  const dnsName = `host-${id}-test.example.com`;
  await upsertProjectHost({
    id,
    name,
    region: "us-central1",
    status: "running",
    public_url: `https://${dnsName}`,
    ssh_server: `${OLD_IP}:2222`,
    metadata: {
      desired_state: "running",
      machine: { cloud: "gcp" },
      public_route: { active_mode: "cloudflare-proxy" },
      runtime: {
        provider: "gcp",
        instance_id: `instance-${id}`,
        zone: "us-central1-a",
        public_ip: OLD_IP,
      },
    },
  });
  // Host heartbeats intentionally cannot write these control-plane subtrees.
  await getPool().query(
    `
      UPDATE project_hosts
      SET metadata=metadata
        || jsonb_build_object(
          'public_route',
          jsonb_build_object('active_mode', 'cloudflare-proxy'),
          'dns',
          jsonb_build_object('name', $2::text, 'record_id', 'record-1')
        )
      WHERE id=$1
    `,
    [id, dnsName],
  );
}

async function setRecentDnsFailure(
  hostIds: string[],
  consecutiveFailures: number,
  error: string,
): Promise<void> {
  await getPool().query(
    `
      UPDATE project_hosts
      SET metadata=jsonb_set(
        metadata,
        '{dns_reconciliation}',
        jsonb_build_object(
          'status', 'failed',
          'failed_at', NOW(),
          'attempted_at', NOW(),
          'error', $2::text,
          'consecutive_failures', $3::integer
        ),
        true
      )
      WHERE id=ANY($1::uuid[])
    `,
    [hostIds, error, consecutiveFailures],
  );
}

beforeAll(async () => {
  await before({ noConat: true });
}, 15_000);

afterAll(after);

beforeEach(async () => {
  jest.clearAllMocks();
  await getPool().query("DELETE FROM cloud_vm_log");
  await getPool().query("DELETE FROM cloud_vm_work");
  await getPool().query("DELETE FROM project_hosts");
  getProviderContextMock.mockResolvedValue({
    entry: {
      provider: {
        mapStatus: (status?: string) => status?.toLowerCase(),
        getInstance: jest.fn(async () => ({
          instance_id: `instance-${HOST_ID}`,
          status: "RUNNING",
          public_ip: NEW_IP,
          private_ip: "10.0.0.20",
          internal_hostname: "instance.internal",
        })),
      },
    },
    creds: {},
  });
  ensureHostDnsMock.mockResolvedValue({
    name: DNS_NAME,
    record_id: "record-1",
  });
  inspectHostDnsMock.mockResolvedValue({
    name: DNS_NAME,
    records: [
      {
        record_id: "record-1",
        type: "A",
        content: NEW_IP,
        proxied: true,
      },
    ],
  });
  adminAlertMock.mockResolvedValue(undefined);
  await addDirectHost(HOST_ID, "DNS reconciliation test host");
});

describe("project-host DNS desired-state reconciliation", () => {
  it("updates provider runtime state and verifies the Cloudflare record", async () => {
    const { reconcileHostDns } = await import("./host-dns-reconciliation");
    await expect(reconcileHostDns(HOST_ID)).resolves.toMatchObject({
      public_ip: NEW_IP,
      record_id: "record-1",
    });

    expect(ensureHostDnsMock).toHaveBeenCalledWith({
      host_id: HOST_ID,
      ipAddress: NEW_IP,
      record_id: "record-1",
    });
    expect(inspectHostDnsMock).toHaveBeenCalledWith({ host_id: HOST_ID });

    const { rows } = await getPool().query(
      `
        SELECT metadata, public_url, ssh_server
        FROM project_hosts
        WHERE id=$1
      `,
      [HOST_ID],
    );
    expect(rows[0].metadata.runtime).toMatchObject({
      public_ip: NEW_IP,
      private_ip: "10.0.0.20",
      internal_hostname: "instance.internal",
      provider_status: "RUNNING",
    });
    expect(rows[0].metadata.dns_reconciliation).toMatchObject({
      status: "verified",
      desired_ip: NEW_IP,
      observed_dns_ip: NEW_IP,
      record_id: "record-1",
      consecutive_failures: 0,
    });
    expect(rows[0].public_url).toBe(`https://${DNS_NAME}`);
    expect(rows[0].ssh_server).toBe(`${NEW_IP}:2222`);
  });

  it("records verification failure and leaves a durable retry queued", async () => {
    inspectHostDnsMock.mockResolvedValue({
      name: DNS_NAME,
      records: [
        {
          record_id: "record-1",
          type: "A",
          content: OLD_IP,
          proxied: true,
        },
      ],
    });
    const { handleHostDnsReconciliationWork } =
      await import("./host-dns-reconciliation");
    await expect(
      handleHostDnsReconciliationWork({
        vm_id: HOST_ID,
        payload: { attempt: 0 },
      }),
    ).rejects.toThrow(/verification failed/);

    const host = await getPool().query(
      "SELECT metadata FROM project_hosts WHERE id=$1",
      [HOST_ID],
    );
    expect(host.rows[0].metadata.dns_reconciliation).toMatchObject({
      status: "failed",
      desired_ip: NEW_IP,
      consecutive_failures: 1,
    });
    const work = await getPool().query(
      `
        SELECT action, state, not_before, payload
        FROM cloud_vm_work
        WHERE vm_id=$1
      `,
      [HOST_ID],
    );
    expect(work.rows).toHaveLength(1);
    expect(work.rows[0]).toMatchObject({
      action: "reconcile_dns",
      state: "queued",
      payload: expect.objectContaining({ attempt: 1, reason: "retry" }),
    });
    expect(new Date(work.rows[0].not_before).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("deduplicates changing diagnostics for an isolated host alert", async () => {
    const timeout = Object.assign(
      new Error("The operation was aborted due to timeout"),
      { name: "TimeoutError" },
    );
    await setRecentDnsFailure(
      [HOST_ID],
      4,
      `${timeout.name}: ${timeout.message}`,
    );
    ensureHostDnsMock.mockRejectedValue(timeout);
    const { handleHostDnsReconciliationWork } =
      await import("./host-dns-reconciliation");

    await expect(
      handleHostDnsReconciliationWork({
        vm_id: HOST_ID,
        payload: { attempt: 4 },
      }),
    ).rejects.toThrow(/aborted due to timeout/);

    expect(adminAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject:
          "Project-host DNS reconciliation failed: DNS reconciliation test host",
        dedupMinutes: 15,
        dedupBySubject: true,
      }),
    );
  });

  it("collapses a correlated Cloudflare outage into a fleet alert", async () => {
    const secondHost = "cd515768-25f7-4e24-8e6a-edc2b321d536";
    const thirdHost = "4a6cd1c1-f60b-4f3b-8ce5-96ee86245b48";
    const timeout = Object.assign(
      new Error("The operation was aborted due to timeout"),
      { name: "TimeoutError" },
    );
    const error = `${timeout.name}: ${timeout.message}`;
    await addDirectHost(secondHost, "DNS reconciliation test host 2");
    await addDirectHost(thirdHost, "DNS reconciliation test host 3");
    await setRecentDnsFailure([HOST_ID, secondHost, thirdHost], 4, error);
    ensureHostDnsMock.mockRejectedValue(timeout);
    const { handleHostDnsReconciliationWork } =
      await import("./host-dns-reconciliation");

    await expect(
      handleHostDnsReconciliationWork({
        vm_id: HOST_ID,
        payload: { attempt: 4 },
      }),
    ).rejects.toThrow(/aborted due to timeout/);

    expect(adminAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "[bay-0] Project-host DNS reconciliation fleet degraded",
        body: expect.stringContaining('"shared_cloudflare_failure":true'),
        dedupMinutes: 4 * 60,
        dedupBySubject: true,
      }),
    );
    expect(adminAlertMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining(
          "Project-host DNS reconciliation failed:",
        ),
      }),
    );
  });

  it("does not certify DNS when the runtime IP changes concurrently", async () => {
    const concurrentIp = "203.0.113.30";
    ensureHostDnsMock.mockImplementation(async () => {
      await getPool().query(
        `
          UPDATE project_hosts
          SET metadata=jsonb_set(
            metadata,
            '{runtime,public_ip}',
            to_jsonb($2::text)
          )
          WHERE id=$1
        `,
        [HOST_ID, concurrentIp],
      );
      return { name: DNS_NAME, record_id: "record-1" };
    });
    const { handleHostDnsReconciliationWork } =
      await import("./host-dns-reconciliation");
    await expect(
      handleHostDnsReconciliationWork({
        vm_id: HOST_ID,
        payload: { attempt: 0 },
      }),
    ).rejects.toThrow(/runtime public IP changed/);

    const { rows } = await getPool().query(
      "SELECT metadata FROM project_hosts WHERE id=$1",
      [HOST_ID],
    );
    expect(rows[0].metadata.runtime.public_ip).toBe(concurrentIp);
    expect(rows[0].metadata.dns_reconciliation).toMatchObject({
      status: "failed",
      desired_ip: concurrentIp,
      consecutive_failures: 1,
    });
  });

  it("periodically rechecks verified records to detect external drift", async () => {
    const { enqueueDueHostDnsReconciliation, reconcileHostDns } =
      await import("./host-dns-reconciliation");
    await reconcileHostDns(HOST_ID);
    expect(await enqueueDueHostDnsReconciliation()).toBe(0);

    await getPool().query(
      `
        UPDATE project_hosts
        SET metadata=jsonb_set(
          metadata,
          '{dns_reconciliation,verified_at}',
          to_jsonb((NOW() - interval '10 minutes')::text)
        )
        WHERE id=$1
      `,
      [HOST_ID],
    );
    expect(await enqueueDueHostDnsReconciliation()).toBe(1);
    const { rows } = await getPool().query(
      `
        SELECT action, state
        FROM cloud_vm_work
        WHERE vm_id=$1
      `,
      [HOST_ID],
    );
    expect(rows).toEqual([{ action: "reconcile_dns", state: "queued" }]);
  });

  it("reclaims reconciliation abandoned by a restarted hub worker", async () => {
    const { enqueueDueHostDnsReconciliation, handleHostDnsReconciliationWork } =
      await import("./host-dns-reconciliation");
    const { processCloudVmWorkOnce } = await import("./worker");
    expect(await enqueueDueHostDnsReconciliation()).toBe(1);
    await getPool().query(
      `
        UPDATE cloud_vm_work
        SET state='in_progress',
            locked_by='terminated-hub-worker',
            locked_at=NOW() - interval '3 minutes'
        WHERE vm_id=$1
          AND action='reconcile_dns'
      `,
      [HOST_ID],
    );

    await expect(
      processCloudVmWorkOnce({
        worker_id: "replacement-hub-worker",
        handlers: {
          reconcile_dns: handleHostDnsReconciliationWork,
        },
      }),
    ).resolves.toBe(1);

    const work = await getPool().query(
      `
        SELECT state, locked_by, locked_at, attempt
        FROM cloud_vm_work
        WHERE vm_id=$1
      `,
      [HOST_ID],
    );
    expect(work.rows).toEqual([
      {
        state: "done",
        locked_by: null,
        locked_at: null,
        attempt: 1,
      },
    ]);
    const host = await getPool().query(
      "SELECT metadata FROM project_hosts WHERE id=$1",
      [HOST_ID],
    );
    expect(host.rows[0].metadata.dns_reconciliation.status).toBe("verified");
  });
});
