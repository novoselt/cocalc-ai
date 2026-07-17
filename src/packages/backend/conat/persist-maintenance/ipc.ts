/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import type {
  PersistMaintenanceCoordinatorEvent,
  PersistMaintenanceWorkerEvent,
} from "@cocalc/conat/persist/maintenance/protocol";
import type {
  PersistMaintenanceHooks,
  PersistMaintenancePath,
  PersistMaintenanceUse,
} from "@cocalc/conat/persist/maintenance/types";

function processStartToken(): string {
  try {
    const stat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
    const end = stat.lastIndexOf(")");
    return stat.slice(end + 2).split(" ")[19] || `${process.pid}`;
  } catch {
    return `${process.pid}-${process.uptime().toFixed(3)}`;
  }
}

export function createIpcPersistMaintenanceHooks({
  workerId,
  timeoutMs = 1000,
}: {
  workerId: string;
  timeoutMs?: number;
}): PersistMaintenanceHooks | undefined {
  if (process.send == null) return;
  const ownerId = `${workerId}:${process.pid}:${randomUUID()}`;
  const owner = {
    ownerId,
    workerId,
    pid: process.pid,
    processStartToken: processStartToken(),
  };
  const pending = new Map<
    string,
    { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  const send = (event: PersistMaintenanceWorkerEvent) => {
    if (!process.connected || process.send == null) {
      throw new Error("persist maintenance IPC is disconnected");
    }
    process.send(event);
  };
  const register = () => {
    send({ type: "register", ...owner });
  };
  process.on("message", (message: PersistMaintenanceCoordinatorEvent) => {
    if (message?.type !== "begin-open-ack") return;
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    clearTimeout(request.timer);
    if (message.ok) request.resolve();
    else request.reject(new Error(message.error));
  });
  register();

  const begin = async (
    path: PersistMaintenancePath,
  ): Promise<PersistMaintenanceUse> => {
    register();
    const use: PersistMaintenanceUse = { ...path, ...owner };
    const requestId = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        try {
          send({
            type: "tracking-unavailable",
            workerId,
            error: `begin-open acknowledgement timed out after ${timeoutMs}ms`,
          });
        } catch {}
        reject(
          new Error(
            `persist maintenance begin-open acknowledgement timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      timer.unref?.();
      pending.set(requestId, { resolve, reject, timer });
      try {
        send({ type: "begin-open", requestId, use });
      } catch (err) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(err);
      }
    });
    return use;
  };

  return {
    beginOpen: async (path) => {
      const use = await begin(path);
      return {
        ownerId,
        onMutation: () => {
          try {
            send({ type: "mutation", use });
          } catch {}
        },
        onFinalClose: (dirty) => {
          try {
            send({ type: "closed", close: { ...use, dirty } });
          } catch {}
        },
      };
    },
    openFailed: (path, error) => {
      const use: PersistMaintenanceUse = { ...path, ...owner };
      try {
        send({ type: "open-failed", use, error: `${error}` });
      } catch {}
    },
    trackingUnavailable: (error) => {
      try {
        send({ type: "tracking-unavailable", workerId, error: `${error}` });
      } catch {}
    },
  };
}
