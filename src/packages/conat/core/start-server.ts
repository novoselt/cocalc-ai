import { type Options } from "./server";
import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const children: ChildProcess[] = [];
let lifecycleHandlersInstalled = false;

function installLifecycleHandlers() {
  if (lifecycleHandlersInstalled) {
    return;
  }
  lifecycleHandlersInstalled = true;

  process.once("exit", close);
  ["SIGTERM", "SIGQUIT"].forEach((sig) => {
    process.once(sig, () => {
      children.map((child) => child.kill(sig as NodeJS.Signals));
    });
  });
}

function resolveClusterNodeEntrypoint(): string {
  const explicit =
    `${process.env.COCALC_CONAT_CLUSTER_NODE_ENTRYPOINT ?? ""}`.trim();
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(
        `COCALC_CONAT_CLUSTER_NODE_ENTRYPOINT does not exist: ${explicit}`,
      );
    }
    return explicit;
  }
  return join(
    __dirname,
    "..",
    "..",
    "..",
    "server",
    "dist",
    "conat",
    "socketio",
    "start-cluster-node.js",
  );
}

export function forkedConatServer(opts: Options) {
  const child: ChildProcess = fork(resolveClusterNodeEntrypoint(), [], {
    env: {
      ...process.env,
      COCALC_CONAT_CLUSTER_NODE: "1",
    },
  });
  children.push(child);
  child.once("exit", () => {
    const index = children.indexOf(child);
    if (index !== -1) {
      children.splice(index, 1);
    }
  });
  installLifecycleHandlers();
  child.send(opts);
}

function close() {
  children.map((child) => child.kill("SIGKILL"));
}
