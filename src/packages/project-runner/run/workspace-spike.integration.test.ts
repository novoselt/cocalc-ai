import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile as readLocalFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import getPort from "@cocalc/backend/get-port";
import { readFile } from "@cocalc/conat/files/read";
import { writeFile as writeProjectFile } from "@cocalc/conat/files/write";
import { Client as ConatClient } from "@cocalc/conat/core/client";
import {
  ConatServer,
  init as createConatServer,
} from "@cocalc/conat/core/server";
import { get as getProjectInfo } from "@cocalc/conat/project/project-info";
import { terminalClient } from "@cocalc/conat/project/terminal";
import { until } from "@cocalc/util/async-utils";

jest.setTimeout(45_000);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode != null || child.signalCode != null || child.pid == null) {
    return;
  }
  const closed = once(child, "close");
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
  await Promise.race([
    closed,
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode == null && child.signalCode == null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
    await closed;
  }
}

describe("workspace runtime architecture spike", () => {
  it("runs project files, terminal, and status without Podman", async () => {
    const originalTestMode = process.env.COCALC_TEST_MODE;
    process.env.COCALC_TEST_MODE = "1";
    const conatPort = await getPort();
    const proxyPort = await getPort();
    const conatServer = createConatServer({
      id: "workspace-runtime-spike",
      clusterName: "workspace-runtime-spike",
      path: "/conat",
      port: conatPort,
      systemAccountPassword: "workspace-runtime-spike",
    });
    if (conatServer.state !== "ready") {
      await once(conatServer, "ready");
    }
    const client = conatServer.client({ noCache: true, path: "/" });
    await client.waitUntilConnected();

    const root = await mkdtemp(join(tmpdir(), "cocalc-workspace-spike-"));
    const home = join(root, "projects", PROJECT_ID);
    const data = join(home, ".cache", "cocalc", "project");
    await mkdir(data, { recursive: true });
    await writeFile(join(data, "secret-token"), "workspace-spike-secret");

    const extraEnv = Buffer.from(
      JSON.stringify({
        COCALC_PROJECT_INFO_SCOPE: "owned",
        CONAT_SERVER: conatServer.address(),
        DATA: data,
      }),
    ).toString("base64");
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      DATA: data,
      PATH: process.env.PATH,
      NODE_PATH: process.env.NODE_PATH,
      USER: process.env.USER,
      LOGNAME: process.env.LOGNAME,
      COCALC_EXTRA_ENV: extraEnv,
      COCALC_PROJECT_ID: PROJECT_ID,
      COCALC_PROJECT_INFO_HISTORY_SAMPLE_SECONDS: "0",
      COCALC_PROXY_HOST: "127.0.0.1",
      COCALC_PROXY_PORT: `${proxyPort}`,
      COCALC_SECRET_TOKEN: join(data, "secret-token"),
      COCALC_USERNAME: process.env.USER ?? "user",
      CONAT_SERVER: conatServer.address(),
      DEBUG: "",
      DEBUG_CONSOLE: "no",
    };
    const projectBin = join(
      __dirname,
      "..",
      "..",
      "project",
      "bin",
      "cocalc-project.js",
    );
    const child = spawn(
      process.execPath,
      [projectBin, "--hostname", "127.0.0.1"],
      {
        cwd: home,
        detached: true,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk;
    });

    const terminal = terminalClient({
      client,
      project_id: PROJECT_ID,
      reconnection: false,
    });
    try {
      let info;
      await until(
        async () => {
          try {
            info = await getProjectInfo({
              client,
              project_id: PROJECT_ID,
            });
            return info != null;
          } catch {
            return false;
          }
        },
        { start: 100, max: 1_000, timeout: 20_000 },
      );
      expect(info?.scope).toBe("owned");

      await writeProjectFile({
        client,
        project_id: PROJECT_ID,
        path: "workspace-proof.txt",
        stream: Readable.from([Buffer.from("workspace-file-proof")]),
        maxWait: 10_000,
      });
      const chunks: Buffer[] = [];
      for await (const chunk of await readFile({
        client,
        project_id: PROJECT_ID,
        path: "workspace-proof.txt",
        maxWait: 10_000,
      })) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString()).toBe("workspace-file-proof");
      expect(
        await readLocalFile(join(home, "workspace-proof.txt"), "utf8"),
      ).toBe("workspace-file-proof");

      const terminalId = "workspace-spike-terminal";
      await terminal.spawn("/bin/bash", [], {
        cwd: home,
        id: terminalId,
        timeout: 10_000,
      });
      await terminal.write({
        id: terminalId,
        input: "printf terminal-proof > terminal-proof.txt\n",
        kind: "user",
      });
      await until(
        async () => {
          try {
            return (
              (await readLocalFile(
                join(home, "terminal-proof.txt"),
                "utf8",
              )) === "terminal-proof"
            );
          } catch {
            return false;
          }
        },
        { start: 50, max: 500, timeout: 10_000 },
      );
      expect(
        await readLocalFile(join(home, "terminal-proof.txt"), "utf8"),
      ).toBe("terminal-proof");
      await terminal.destroy();
    } catch (err) {
      throw new Error(
        `workspace project process spike failed: ${err}\n${output.slice(-8_000)}`,
      );
    } finally {
      terminal.close();
      await stopChild(child);
      expect(child.exitCode != null || child.signalCode != null).toBe(true);
      await client.close();
      await conatServer.close();
      ConatClient.closeAllForTests();
      await ConatServer.closeAllForTests();
      await rm(root, { recursive: true, force: true });
      if (originalTestMode == null) {
        delete process.env.COCALC_TEST_MODE;
      } else {
        process.env.COCALC_TEST_MODE = originalTestMode;
      }
    }
  });
});
