/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { AsyncLocalStorage } from "async_hooks";
import type { PoolClient } from "pg";

type QueryClientContext = {
  active: boolean;
  client: PoolClient;
  owner: object;
};

const queryClientContext = new AsyncLocalStorage<QueryClientContext>();

function getContext(owner: object): QueryClientContext | undefined {
  const context = queryClientContext.getStore();
  if (!context?.active || context.owner !== owner) return undefined;
  return context;
}

export function getScopedQueryClient(owner: object): PoolClient | undefined {
  return getContext(owner)?.client;
}

export function isScopedQueryClient(
  owner: object,
  client: PoolClient,
): boolean {
  return getScopedQueryClient(owner) === client;
}

export async function runWithScopedQueryClient<T>({
  owner,
  client,
  fn,
}: {
  owner: object;
  client: PoolClient;
  fn: () => Promise<T>;
}): Promise<T> {
  const context: QueryClientContext = { active: true, client, owner };
  return await queryClientContext.run(context, async () => {
    try {
      return await fn();
    } finally {
      // Async work accidentally left running by fn must not reuse this client
      // after its transaction has committed and the client has been released.
      context.active = false;
    }
  });
}
