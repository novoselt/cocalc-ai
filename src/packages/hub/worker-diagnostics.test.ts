/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { AddressInfo } from "node:net";
import {
  collectWorkerDiagnostics,
  createWorkerDiagnosticsServer,
  resolveWorkerDiagnosticsPort,
  WORKER_DIAGNOSTICS_HOST,
  WORKER_DIAGNOSTICS_PATH,
} from "./worker-diagnostics";

jest.mock("@cocalc/conat/client", () => ({
  numSubscriptions: jest.fn(() => 17),
}));

jest.mock("@cocalc/server/conat/route-client", () => ({
  getRoutedClientCacheStats: jest.fn(() => ({
    hub_clients: 3,
    account_clients: 5,
  })),
}));

jest.mock("@cocalc/server/conat", () => ({
  getConatPersistDiagnostics: jest.fn(() => ({
    mode: "in-process",
    configured_servers: 1,
    child_processes: 0,
    local_open_streams: 11,
    local_streams: {
      open_total: 11,
      open_ephemeral: 9,
      open_disk: 2,
    },
  })),
}));

describe("hub worker diagnostics", () => {
  it("derives a distinct loopback port for each bay worker", () => {
    expect(WORKER_DIAGNOSTICS_HOST).toBe("127.0.0.1");
    expect(
      resolveWorkerDiagnosticsPort({
        COCALC_BAY_WORKER_ID: "2",
        COCALC_BAY_WORKER_PORT: "9301",
      }),
    ).toBe(11301);
    expect(
      resolveWorkerDiagnosticsPort({
        COCALC_HUB_WORKER_DIAGNOSTICS_PORT: "12000",
      }),
    ).toBe(12000);
    expect(resolveWorkerDiagnosticsPort({})).toBeUndefined();
    expect(() =>
      resolveWorkerDiagnosticsPort({
        COCALC_HUB_WORKER_DIAGNOSTICS_PORT: "70000",
      }),
    ).toThrow("COCALC_HUB_WORKER_DIAGNOSTICS_PORT");
    expect(() =>
      resolveWorkerDiagnosticsPort({
        COCALC_HUB_WORKER_DIAGNOSTICS_PORT: "9300junk",
      }),
    ).toThrow("COCALC_HUB_WORKER_DIAGNOSTICS_PORT");
  });

  it("collects aggregate process, V8, Conat, and persistence data", () => {
    const diagnostics = collectWorkerDiagnostics();
    expect(diagnostics.schema_version).toBe(1);
    expect(diagnostics.process.pid).toBe(process.pid);
    expect(diagnostics.process.memory.rss).toBeGreaterThan(0);
    expect(diagnostics.v8.heap.heap_size_limit).toBeGreaterThan(0);
    expect(diagnostics.v8.heap_spaces.length).toBeGreaterThan(0);
    expect(diagnostics.conat.local_client_subscriptions).toBe(17);
    expect(diagnostics.conat.routed_clients).toEqual(
      expect.objectContaining({ hub_clients: 3, account_clients: 5 }),
    );
    expect(diagnostics.conat.persistence.local_open_streams).toBe(11);
    expect(diagnostics.conat.persistence.local_streams).toEqual(
      expect.objectContaining({ open_ephemeral: 9, open_disk: 2 }),
    );
  });

  it("serves diagnostics without exposing any other route", async () => {
    const server = createWorkerDiagnosticsServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const { port } = server.address() as AddressInfo;
      const diagnostics = await fetch(
        `http://127.0.0.1:${port}${WORKER_DIAGNOSTICS_PATH}`,
      );
      expect(diagnostics.status).toBe(200);
      expect(diagnostics.headers.get("cache-control")).toContain("no-store");
      expect((await diagnostics.json()).schema_version).toBe(1);

      const missing = await fetch(`http://127.0.0.1:${port}/`);
      expect(missing.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
