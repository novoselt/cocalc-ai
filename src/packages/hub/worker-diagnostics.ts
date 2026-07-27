/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import { numSubscriptions } from "@cocalc/conat/client";
import {
  getConatPersistDiagnostics,
  getConatPersistSqliteDiagnostics,
} from "@cocalc/server/conat";
import { getRoutedClientCacheStats } from "@cocalc/server/conat/route-client";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { performance } from "node:perf_hooks";
import {
  getHeapCodeStatistics,
  getHeapSpaceStatistics,
  getHeapStatistics,
} from "node:v8";

const logger = getLogger("hub:worker-diagnostics");

export const WORKER_DIAGNOSTICS_HOST = "127.0.0.1";
export const WORKER_DIAGNOSTICS_PATH = "/diagnostics";
const WORKER_DIAGNOSTICS_PORT_OFFSET = 2_000;

function parsePort(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer from 1 through 65535`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`${name} must be an integer from 1 through 65535`);
  }
  return port;
}

export function resolveWorkerDiagnosticsPort(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const explicit = `${env.COCALC_HUB_WORKER_DIAGNOSTICS_PORT ?? ""}`.trim();
  if (explicit) {
    return parsePort(explicit, "COCALC_HUB_WORKER_DIAGNOSTICS_PORT");
  }
  if (!`${env.COCALC_BAY_WORKER_ID ?? ""}`.trim()) {
    return undefined;
  }
  const workerPortRaw = `${env.COCALC_BAY_WORKER_PORT ?? ""}`.trim();
  if (!workerPortRaw) {
    return undefined;
  }
  const workerPort = parsePort(workerPortRaw, "COCALC_BAY_WORKER_PORT");
  const diagnosticsPort = workerPort + WORKER_DIAGNOSTICS_PORT_OFFSET;
  if (diagnosticsPort > 65_535) {
    throw new Error(
      `derived worker diagnostics port ${diagnosticsPort} exceeds 65535`,
    );
  }
  return diagnosticsPort;
}

function countActiveResources(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const type of process.getActiveResourcesInfo?.() ?? []) {
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function collectWorkerDiagnostics({
  includePersistenceDetail = false,
}: {
  includePersistenceDetail?: boolean;
} = {}) {
  const persistence = getConatPersistDiagnostics();
  return {
    schema_version: 1,
    collected_at: new Date().toISOString(),
    process: {
      pid: process.pid,
      worker_id: process.env.COCALC_BAY_WORKER_ID ?? null,
      node_version: process.version,
      uptime_seconds: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      resource_usage: process.resourceUsage(),
      active_resources: countActiveResources(),
      event_loop_utilization: performance.eventLoopUtilization(),
    },
    v8: {
      heap: getHeapStatistics(),
      heap_spaces: getHeapSpaceStatistics(),
      heap_code: getHeapCodeStatistics(),
    },
    conat: {
      local_client_subscriptions: numSubscriptions(),
      routed_clients: getRoutedClientCacheStats(),
      persistence: {
        ...persistence,
        ...(includePersistenceDetail
          ? { sqlite_detail: getConatPersistSqliteDiagnostics() }
          : {}),
      },
    },
  };
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(`${JSON.stringify(value)}\n`);
}

function handleDiagnosticsRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const url = new URL(
    request.url ?? WORKER_DIAGNOSTICS_PATH,
    `http://${WORKER_DIAGNOSTICS_HOST}`,
  );
  const path = url.pathname;
  if (request.method !== "GET" || path !== WORKER_DIAGNOSTICS_PATH) {
    sendJson(response, 404, { error: "not found" });
    return;
  }
  try {
    sendJson(
      response,
      200,
      collectWorkerDiagnostics({
        includePersistenceDetail:
          url.searchParams.get("persistence") === "full",
      }),
    );
  } catch (err) {
    logger.warn("failed collecting worker diagnostics", { err: `${err}` });
    sendJson(response, 500, { error: "diagnostics unavailable" });
  }
}

export function createWorkerDiagnosticsServer(): Server {
  return createServer(handleDiagnosticsRequest);
}

let workerDiagnosticsServer: Server | undefined;

export async function startWorkerDiagnosticsServer(): Promise<
  Server | undefined
> {
  if (workerDiagnosticsServer) {
    return workerDiagnosticsServer;
  }
  const port = resolveWorkerDiagnosticsPort();
  if (port == null) {
    return undefined;
  }
  const server = createWorkerDiagnosticsServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, WORKER_DIAGNOSTICS_HOST);
  });
  workerDiagnosticsServer = server;
  logger.info("worker diagnostics listening", {
    host: WORKER_DIAGNOSTICS_HOST,
    port,
    path: WORKER_DIAGNOSTICS_PATH,
    worker_id: process.env.COCALC_BAY_WORKER_ID,
  });
  return server;
}
