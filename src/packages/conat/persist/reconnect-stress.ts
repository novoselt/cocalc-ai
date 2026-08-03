/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { once } from "node:events";
import { connect, type Client } from "@cocalc/conat/core/client";
import { stream } from "@cocalc/conat/persist/client";

interface Options {
  address: string;
  count: number;
  durationMs: number;
  password: string;
  prefix: string;
  projectId: string;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseOptions(): Options {
  const values = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i];
    const value = process.argv[i + 1];
    if (!name?.startsWith("--") || value == null) {
      throw new Error(`invalid argument near '${name ?? ""}'`);
    }
    values.set(name.slice(2), value);
  }
  const required = (name: string, envName?: string): string => {
    const value = values.get(name) ?? (envName ? process.env[envName] : "");
    if (!value) {
      throw new Error(`--${name} is required`);
    }
    return value;
  };
  return {
    address: required("address", "PERSIST_STRESS_ADDRESS"),
    count: parsePositiveInteger(values.get("count") ?? "300", "count"),
    durationMs:
      parsePositiveInteger(values.get("duration-s") ?? "300", "duration-s") *
      1000,
    password: required("password", "PERSIST_STRESS_SYSTEM_PASSWORD"),
    prefix:
      values.get("prefix") ??
      `persist-reconnect-stress-${new Date().toISOString().replace(/\W/g, "-")}`,
    projectId: required("project-id", "PERSIST_STRESS_PROJECT_ID"),
  };
}

async function waitForClient(
  client: Client,
  timeoutMs = 30_000,
): Promise<void> {
  if (client.state === "connected") {
    return;
  }
  await Promise.race([
    once(client, "connected"),
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for Conat connection")),
        timeoutMs,
      );
      timer.unref();
    }),
  ]);
}

async function main(): Promise<void> {
  const options = parseOptions();
  const client = connect({
    address: options.address,
    systemAccountPassword: options.password,
    noCache: true,
    reconnection: true,
    transports: ["websocket"],
    recoveryConcurrency: 50,
  });
  const streams: ReturnType<typeof stream>[] = [];
  const recoveryStartedAt = new WeakMap<object, number>();
  const recoveryDurationsMs: number[] = [];
  let disconnects = 0;
  let recoveries = 0;
  let errors = 0;
  let stopping = false;

  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await waitForClient(client);
  process.stdout.write(
    `${JSON.stringify({
      event: "connected",
      address: options.address,
      count: options.count,
      prefix: options.prefix,
      project_id: options.projectId,
    })}\n`,
  );

  let next = 0;
  const initialize = async () => {
    while (!stopping) {
      const index = next++;
      if (index >= options.count) {
        return;
      }
      const persistent = stream({
        client,
        user: { project_id: options.projectId },
        storage: {
          path: `projects/${options.projectId}/${options.prefix}/${index}`,
        },
        noCache: true,
      });
      persistent.on("error", () => {
        errors += 1;
      });
      persistent.on("disconnected", () => {
        disconnects += 1;
        recoveryStartedAt.set(persistent, Date.now());
      });
      persistent.on("recovered", () => {
        recoveries += 1;
        const startedAt = recoveryStartedAt.get(persistent);
        if (startedAt != null) {
          recoveryDurationsMs.push(Date.now() - startedAt);
        }
      });
      await persistent.set({
        messageData: client.message({ index, seeded_at: Date.now() }),
        timeout: 30_000,
      });
      await persistent.changefeed({ activateRemote: false });
      await persistent.getAll({ changefeed: true, timeout: 30_000 });
      streams.push(persistent);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(25, options.count) }, initialize),
  );

  process.stdout.write(
    `${JSON.stringify({ event: "ready", streams: streams.length })}\n`,
  );
  const startedAt = Date.now();
  while (!stopping && Date.now() - startedAt < options.durationMs) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const sorted = [...recoveryDurationsMs].sort((a, b) => a - b);
    process.stdout.write(
      `${JSON.stringify({
        event: "status",
        client_state: client.state,
        disconnects,
        errors,
        recoveries,
        recovery_max_ms: sorted.at(-1) ?? 0,
        recovery_p50_ms: sorted[Math.floor(sorted.length / 2)] ?? 0,
        streams: streams.length,
      })}\n`,
    );
  }

  for (const persistent of streams) {
    persistent.close();
  }
  client.close();
  process.stdout.write(
    `${JSON.stringify({
      event: "closed",
      disconnects,
      errors,
      recoveries,
      recovery_max_ms: recoveryDurationsMs.length
        ? Math.max(...recoveryDurationsMs)
        : 0,
      streams: streams.length,
    })}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err}\n`);
  process.exit(1);
});
