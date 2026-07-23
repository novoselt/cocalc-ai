import { fork, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import getLogger from "@cocalc/backend/logger";
import type { PersistMaintenanceWorkerEvent } from "@cocalc/conat/persist/maintenance/protocol";
import type { PersistMaintenanceCoordinator } from "@cocalc/backend/conat/persist-maintenance/coordinator";

const logger = getLogger("server:conat:persist");

const children = new Map<string, ChildProcess>();
let shuttingDown = false;
let lifecycleHandlersInstalled = false;

function installLifecycleHandlers() {
  if (lifecycleHandlersInstalled) {
    return;
  }
  lifecycleHandlersInstalled = true;

  process.once("exit", close);
  ["SIGTERM", "SIGQUIT"].forEach((sig) => {
    process.once(sig, () => {
      shuttingDown = true;
      for (const child of children.values()) {
        child.kill(sig as NodeJS.Signals);
      }
    });
  });
}

export function createForkedPersistServer(
  id: string,
  maintenance?: PersistMaintenanceCoordinator,
) {
  logger.debug("createForkedPersistServer", { id });
  const child = fork(join(__dirname, "start-persist-node.js"), [], {
    env: { ...process.env, PERSIST_SERVER_ID: id },
  });
  children.set(id, child);
  installLifecycleHandlers();
  child.on("message", (message: PersistMaintenanceWorkerEvent) => {
    if (!maintenance || message == null) return;
    try {
      switch (message.type) {
        case "register":
          maintenance.registerWorker(message.workerId);
          child.send({ type: "registered", workerId: message.workerId });
          break;
        case "begin-open":
          maintenance.beginOpen(message.use);
          child.send({
            type: "begin-open-ack",
            requestId: message.requestId,
            ok: true,
          });
          break;
        case "open-failed":
          maintenance.openFailed(message.use);
          break;
        case "mutation":
          maintenance.mutation(message.use);
          break;
        case "closed":
          maintenance.closed(message.close);
          break;
        case "tracking-unavailable":
          maintenance.trackingUnavailable(message.workerId, message.error);
          break;
      }
    } catch (err) {
      if (message.type === "begin-open") {
        child.send({
          type: "begin-open-ack",
          requestId: message.requestId,
          ok: false,
          error: `${err}`,
        });
      }
      maintenance.trackingUnavailable(id, err);
    }
  });

  child.on("exit", (code, signal) => {
    children.delete(id);
    maintenance?.unregisterWorker(id);

    if (shuttingDown) return; // we're intentionally stopping everything

    logger.debug(
      `WARNING: Persist server [${id}] exited (code=${code}, signal=${signal}), restarting shortly...`,
    );

    setTimeout(() => {
      createForkedPersistServer(id, maintenance);
    }, 2000); // restart after 2 seconds
  });

  return child;
}

function close() {
  shuttingDown = true;
  for (const child of children.values()) {
    // Avoid SIGKILL; allow proper sqlite shutdown
    child.kill("SIGTERM");
  }
  children.clear();
}
