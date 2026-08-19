/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { PoolClient } from "pg";

import {
  getScopedQueryClient,
  isScopedQueryClient,
  runWithScopedQueryClient,
} from "./query-client-context";

function client(name: string): PoolClient {
  return { name } as unknown as PoolClient;
}

describe("query client async context", () => {
  it("isolates concurrent transaction clients on a shared database", async () => {
    const database = {};
    const first = client("first");
    const second = client("second");
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstBarrier = new Promise<void>(
      (resolve) => (releaseFirst = resolve),
    );
    const secondBarrier = new Promise<void>(
      (resolve) => (releaseSecond = resolve),
    );

    const firstRun = runWithScopedQueryClient({
      owner: database,
      client: first,
      fn: async () => {
        await firstBarrier;
        expect(getScopedQueryClient(database)).toBe(first);
        expect(isScopedQueryClient(database, first)).toBe(true);
      },
    });
    const secondRun = runWithScopedQueryClient({
      owner: database,
      client: second,
      fn: async () => {
        await secondBarrier;
        expect(getScopedQueryClient(database)).toBe(second);
      },
    });

    expect(getScopedQueryClient(database)).toBeUndefined();
    releaseSecond();
    await secondRun;
    releaseFirst();
    await firstRun;
    expect(getScopedQueryClient(database)).toBeUndefined();
  });

  it("does not expose a client to a different database instance", async () => {
    const database = {};
    const otherDatabase = {};
    const scopedClient = client("scoped");

    await runWithScopedQueryClient({
      owner: database,
      client: scopedClient,
      fn: async () => {
        expect(getScopedQueryClient(database)).toBe(scopedClient);
        expect(getScopedQueryClient(otherDatabase)).toBeUndefined();
      },
    });
  });

  it("invalidates context inherited by unawaited work", async () => {
    const database = {};
    const scopedClient = client("scoped");
    let inspectLater!: () => void;
    const later = new Promise<void>((resolve) => (inspectLater = resolve));
    let inheritedClient: PoolClient | undefined;

    await runWithScopedQueryClient({
      owner: database,
      client: scopedClient,
      fn: async () => {
        void later.then(() => {
          inheritedClient = getScopedQueryClient(database);
        });
      },
    });
    inspectLater();
    await later;
    await new Promise((resolve) => setImmediate(resolve));
    expect(inheritedClient).toBeUndefined();
  });
});
