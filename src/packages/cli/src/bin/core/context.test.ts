import assert from "node:assert/strict";
import test from "node:test";

import { createHubApiForContext, hubCallByName } from "./context";

test("createHubApiForContext exposes the notifications hub group", async () => {
  const calls: Array<{ name: string; args: any[]; timeout?: number }> = [];
  const callByName = async <T>(
    name: string,
    args: any[] = [],
    timeout?: number,
  ): Promise<T> => {
    calls.push({ name, args, timeout });
    return { ok: true } as T;
  };
  const hub = createHubApiForContext(callByName);

  const result = await hub.notifications.counts({ account_id: "acct-1" });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    {
      name: "notifications.counts",
      args: [{ account_id: "acct-1" }],
      timeout: undefined,
    },
  ]);
});

test("createHubApiForContext exposes the adminDb hub group", async () => {
  const calls: Array<{ name: string; args: any[]; timeout?: number }> = [];
  const hub = createHubApiForContext(async <T>(name, args = [], timeout) => {
    calls.push({ name, args, timeout });
    return { audit_id: "audit-1", rows: [] } as T;
  });

  const result = await hub.adminDb.diagnostic({
    diagnostic: "lro",
    params: { kind: "host-reconcile-software" },
  });

  assert.deepEqual(result, { audit_id: "audit-1", rows: [] });
  assert.deepEqual(calls, [
    {
      name: "adminDb.diagnostic",
      args: [
        {
          diagnostic: "lro",
          params: { kind: "host-reconcile-software" },
        },
      ],
      timeout: undefined,
    },
  ]);
});

test("createHubApiForContext exposes the adminHost hub group", async () => {
  const calls: Array<{ name: string; args: any[]; timeout?: number }> = [];
  const hub = createHubApiForContext(async <T>(name, args = [], timeout) => {
    calls.push({ name, args, timeout });
    return { audit_id: "audit-host-1", text: "" } as T;
  });

  const result = await hub.adminHost.logs({
    host_id: "11111111-1111-4111-8111-111111111111",
    source: "host-agent",
  });

  assert.deepEqual(result, { audit_id: "audit-host-1", text: "" });
  assert.deepEqual(calls, [
    {
      name: "adminHost.logs",
      args: [
        {
          host_id: "11111111-1111-4111-8111-111111111111",
          source: "host-agent",
        },
      ],
      timeout: undefined,
    },
  ]);
});

test("createHubApiForContext exposes the adminSupport hub group", async () => {
  const calls: Array<{ name: string; args: any[]; timeout?: number }> = [];
  const hub = createHubApiForContext(async <T>(name, args = [], timeout) => {
    calls.push({ name, args, timeout });
    return { audit_id: "audit-support-1", tickets: [] } as T;
  });

  const result = await hub.adminSupport.triage({
    since_minutes: 60,
    limit: 3,
    reason: "investigate recent support signals",
  });

  assert.deepEqual(result, {
    audit_id: "audit-support-1",
    tickets: [],
  });
  assert.deepEqual(calls, [
    {
      name: "adminSupport.triage",
      args: [
        {
          since_minutes: 60,
          limit: 3,
          reason: "investigate recent support signals",
        },
      ],
      timeout: undefined,
    },
  ]);
});

test("createHubApiForContext forwards explicit per-call timeout", async () => {
  const calls: Array<{ name: string; args: any[]; timeout?: number }> = [];
  const hub = createHubApiForContext(async <T>(name, args = [], timeout) => {
    calls.push({ name, args, timeout });
    return { ok: true } as T;
  });

  await (hub.hosts.updateHostMachine as any)({
    id: "host-1",
    shared_disk_gb: 100,
    timeout: 120_000,
  });

  assert.deepEqual(calls, [
    {
      name: "hosts.updateHostMachine",
      args: [{ id: "host-1", shared_disk_gb: 100, timeout: 120_000 }],
      timeout: 120_000,
    },
  ]);
});

test("hubCallByName forwards auth_session_hash from the remote user", async () => {
  const calls: Array<Record<string, unknown>> = [];

  await hubCallByName({
    ctx: {
      timeoutMs: 15_000,
      rpcTimeoutMs: 15_000,
      accountId: "acct-1",
      remote: {
        client: {} as any,
        user: {
          auth_session_hash: "session-hash-1",
        },
      },
    },
    name: "system.createImpersonationGrant",
    args: [{ subject_account_id: "acct-2" }],
    callHub: async (opts) => {
      calls.push(opts);
      return { ok: true };
    },
  });

  assert.deepEqual(calls, [
    {
      client: {},
      account_id: "acct-1",
      auth_session_hash: "session-hash-1",
      name: "system.createImpersonationGrant",
      args: [{ subject_account_id: "acct-2" }],
      timeout: 15_000,
    },
  ]);
});

test("hubCallByName lets explicit timeouts exceed the default rpc timeout", async () => {
  const calls: Array<Record<string, unknown>> = [];

  await hubCallByName({
    ctx: {
      timeoutMs: 600_000,
      rpcTimeoutMs: 30_000,
      accountId: "acct-1",
      remote: {
        client: {} as any,
      },
    },
    name: "hosts.updateHostMachine",
    args: [{ id: "host-1", timeout: 120_000 }],
    timeout: 120_000,
    callHub: async (opts) => {
      calls.push(opts);
      return { ok: true };
    },
  });

  assert.equal(calls[0].timeout, 120_000);
});
