import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import basePath from "@cocalc/backend/base-path";
import getPort from "@cocalc/backend/get-port";
import { Client as ConatClient } from "@cocalc/conat/core/client";
import {
  ConatServer,
  init as createConatServer,
} from "@cocalc/conat/core/server";
import type { LocalPathFunction } from "@cocalc/conat/project/runner/types";
import {
  sanitizeWorkspaceConfiguredEnvironment,
  WorkspaceRuntimeBackend,
  type WorkspaceRuntimeRecord,
} from "./workspace";

jest.setTimeout(90_000);

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

function projectBin(): string {
  return join(__dirname, "..", "..", "project", "bin", "cocalc-project.js");
}

function localPath(root: string): LocalPathFunction {
  return async ({ project_id, ensure = true }) => {
    const home = join(root, "projects", project_id);
    if (ensure) {
      await mkdir(home, { recursive: true });
    }
    return { home };
  };
}

async function createServer(): Promise<ConatServer> {
  const server = createConatServer({
    id: "workspace-runtime",
    clusterName: "workspace-runtime",
    path: "/conat",
    port: await getPort(),
    systemAccountPassword: "workspace-runtime",
  });
  if (server.state !== "ready") {
    await new Promise<void>((resolve, reject) => {
      server.once("ready", resolve);
      server.once("error", reject);
    });
  }
  return server;
}

describe("workspace runtime backend", () => {
  const originalTestMode = process.env.COCALC_TEST_MODE;

  beforeAll(() => {
    process.env.COCALC_TEST_MODE = "1";
  });

  afterAll(() => {
    if (originalTestMode == null) {
      delete process.env.COCALC_TEST_MODE;
    } else {
      process.env.COCALC_TEST_MODE = originalTestMode;
    }
  });

  it("runs two projects, adopts them, and stops only the target", async () => {
    const server = await createServer();
    const client = server.client({ noCache: true, path: "/" });
    await client.waitUntilConnected();
    const root = await mkdtemp(join(tmpdir(), "cocalc-workspace-runtime-"));
    const options = {
      client,
      projectPath: join(root, "projects"),
      statePath: join(root, "runtime"),
      logsPath: join(root, "logs"),
      projectBin: projectBin(),
      conatServer: server.address(),
      readinessTimeoutMs: 15_000,
      stopTimeoutMs: 3_000,
    };
    const paths = localPath(root);
    const first = new WorkspaceRuntimeBackend({
      ...options,
      runnerInstanceId: "first-runner",
    });
    const started: string[] = [];
    try {
      expect(await first.init()).toEqual([]);
      await access(join(root, "runtime", "site.json"));
      await expect(
        first.save({ project_id: PROJECT_A, rootfs: true, home: true }),
      ).rejects.toThrow("rootfs save is unsupported");
      await expect(
        first.save({ project_id: PROJECT_A, rootfs: false, home: true }),
      ).resolves.toBeUndefined();
      const [a, b] = await Promise.all([
        first.start({
          project_id: PROJECT_A,
          config: { secret: "secret-a" },
          localPath: paths,
        }),
        first.start({
          project_id: PROJECT_B,
          config: { secret: "secret-b" },
          localPath: paths,
        }),
      ]);
      started.push(PROJECT_A, PROJECT_B);
      expect(a).toMatchObject({ state: "running", ssh_port: 0 });
      expect(b).toMatchObject({ state: "running", ssh_port: 0 });
      expect(a.http_port).not.toBe(b.http_port);
      for (const project_id of [PROJECT_A, PROJECT_B]) {
        const record: WorkspaceRuntimeRecord = JSON.parse(
          await readFile(
            join(root, "runtime", "projects", `${project_id}.json`),
            "utf8",
          ),
        );
        const environ = (
          await readFile(`/proc/${record.pid}/environ`, "utf8")
        ).split("\0");
        expect(environ).toContain(
          `COCALC_SECRET_TOKEN=${join(
            root,
            "projects",
            project_id,
            ".cache",
            "cocalc",
            "project",
            "secret-token",
          )}`,
        );
        expect(environ).toContain(`COCALC_USERNAME=${process.env.USER}`);
        expect(environ).toContain(`BASE_PATH=${basePath}`);
        expect(environ).toContain("COCALC_PROJECT_FS=local");
      }

      const second = new WorkspaceRuntimeBackend({
        ...options,
        runnerInstanceId: "second-runner",
      });
      const recovered = await second.init();
      expect(recovered.map(({ project_id }) => project_id).sort()).toEqual([
        PROJECT_A,
        PROJECT_B,
      ]);

      await second.stop({
        project_id: PROJECT_A,
        localPath: paths,
      });
      started.splice(started.indexOf(PROJECT_A), 1);
      expect(
        await second.status({ project_id: PROJECT_A, localPath: paths }),
      ).toEqual({ state: "opened" });
      expect(
        await second.status({ project_id: PROJECT_B, localPath: paths }),
      ).toMatchObject({ state: "running", http_port: b.http_port });

      await second.stop({
        project_id: PROJECT_B,
        localPath: paths,
      });
      started.splice(started.indexOf(PROJECT_B), 1);
      await Promise.all([
        access(join(root, "logs", `${PROJECT_A}.stdout.log`)),
        access(join(root, "logs", `${PROJECT_A}.stderr.log`)),
        access(join(root, "logs", `${PROJECT_B}.stdout.log`)),
        access(join(root, "logs", `${PROJECT_B}.stderr.log`)),
      ]);
    } catch (err) {
      const output = await Promise.all(
        [PROJECT_A, PROJECT_B].flatMap((project_id) =>
          ["stdout", "stderr"].map(async (stream) => {
            const path = join(root, "logs", `${project_id}.${stream}.log`);
            const content = await readFile(path, "utf8").catch(() => "");
            return `${path}\n${content.slice(-8_000)}`;
          }),
        ),
      );
      throw new Error(`${err}\n\n${output.join("\n\n")}`);
    } finally {
      for (const project_id of started) {
        await first
          .stop({ project_id, localPath: paths, force: true })
          .catch(() => {});
      }
      await client.close();
      await server.close();
      ConatClient.closeAllForTests();
      await ConatServer.closeAllForTests();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes a mismatched PID record without signaling that process", async () => {
    const server = await createServer();
    const client = server.client({ noCache: true, path: "/" });
    await client.waitUntilConnected();
    const root = await mkdtemp(join(tmpdir(), "cocalc-workspace-stale-"));
    const recordsPath = join(root, "runtime", "projects");
    const home = join(root, "projects", PROJECT_A);
    const data = join(home, ".cache", "cocalc", "project");
    await mkdir(recordsPath, { recursive: true });
    await mkdir(data, { recursive: true });
    const decoy = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        detached: true,
        env: {
          COCALC_PROJECT_ID: PROJECT_A,
          DATA: data,
          HOME: home,
          PATH: process.env.PATH,
        },
        stdio: "ignore",
      },
    );
    await new Promise<void>((resolve, reject) => {
      decoy.once("spawn", resolve);
      decoy.once("error", reject);
    });
    decoy.unref();
    const stat = await readFile(`/proc/${decoy.pid}/stat`, "utf8");
    const fields = stat
      .slice(stat.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/);
    const record: WorkspaceRuntimeRecord = {
      schema_version: 1,
      project_id: PROJECT_A,
      pid: decoy.pid!,
      process_group_id: decoy.pid!,
      process_start_ticks: `${Number(fields[19]) + 1}`,
      spawned_at: new Date().toISOString(),
      argv0: `cocalc-workspace-project:${PROJECT_A}`,
      executable: await readlink(`/proc/${decoy.pid}/exe`),
      project_bin: projectBin(),
      home,
      data,
      hub_port: 0,
      browser_port: 12345,
      http_port: 12345,
      runner_instance_id: "stale-runner",
      last_observed_state: "running",
    };
    await writeFile(
      join(recordsPath, `${PROJECT_A}.json`),
      JSON.stringify(record),
    );
    try {
      const backend = new WorkspaceRuntimeBackend({
        client,
        projectPath: join(root, "projects"),
        statePath: join(root, "runtime"),
        logsPath: join(root, "logs"),
        projectBin: projectBin(),
        conatServer: server.address(),
      });
      expect(await backend.init()).toEqual([]);
      await expect(
        access(join(recordsPath, `${PROJECT_A}.json`)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(process.kill(decoy.pid!, 0)).toBe(true);
    } finally {
      try {
        process.kill(-decoy.pid!, "SIGKILL");
      } catch {}
      await client.close();
      await server.close();
      ConatClient.closeAllForTests();
      await ConatServer.closeAllForTests();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("drops credential-shaped configured environment variables", () => {
    expect(
      sanitizeWorkspaceConfiguredEnvironment({
        SAFE_FOR_DEV: "yes",
        STRIPE_SECRET_KEY: "no",
        GOOGLE_APPLICATION_CREDENTIALS: "/secret/key.json",
        COCALC_BEARER_TOKEN: "no",
        DATABASE_URL: "postgres://production",
      }),
    ).toEqual({ SAFE_FOR_DEV: "yes" });
  });

  it("recognizes and stops an adopted orphan when proc credentials are hidden", async () => {
    const root = await mkdtemp(join(tmpdir(), "cocalc-workspace-orphan-"));
    const home = join(root, "projects", PROJECT_A);
    const data = join(home, ".cache", "cocalc", "project");
    const recordsPath = join(root, "runtime", "projects");
    const script = join(root, "project-process.js");
    const argv0 = `cocalc-workspace-project:${PROJECT_A}`;
    await mkdir(data, { recursive: true });
    await mkdir(recordsPath, { recursive: true });
    await writeFile(script, "setInterval(() => {}, 1000);\n");
    const spawner = spawn(
      process.execPath,
      [
        "-e",
        `
          const { spawn } = require("node:child_process");
          const [script, argv0, home, data, projectId] = process.argv.slice(1);
          const child = spawn(process.execPath, [script], {
            argv0,
            detached: true,
            env: { COCALC_PROJECT_ID: projectId, DATA: data, HOME: home },
            stdio: "ignore",
          });
          child.once("spawn", () => {
            process.stdout.write(String(child.pid));
            child.unref();
          });
        `,
        script,
        argv0,
        home,
        data,
        PROJECT_A,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let output = "";
    spawner.stdout.on("data", (chunk) => {
      output += chunk;
    });
    await once(spawner, "close");
    const pid = Number(output);
    expect(pid).toBeGreaterThan(1);
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat
      .slice(stat.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/);
    const record: WorkspaceRuntimeRecord = {
      schema_version: 1,
      project_id: PROJECT_A,
      pid,
      process_group_id: pid,
      process_start_ticks: fields[19],
      spawned_at: new Date().toISOString(),
      argv0,
      executable: process.execPath,
      project_bin: script,
      home,
      data,
      hub_port: 0,
      browser_port: 12345,
      http_port: 12345,
      runner_instance_id: "orphaned-runner",
      last_observed_state: "running",
    };
    await writeFile(
      join(recordsPath, `${PROJECT_A}.json`),
      JSON.stringify(record),
    );
    const paths = localPath(root);
    const backend = new WorkspaceRuntimeBackend({
      client: {} as ConatClient,
      projectPath: join(root, "projects"),
      statePath: join(root, "runtime"),
      logsPath: join(root, "logs"),
      projectBin: script,
      conatServer: "http://127.0.0.1:1",
      stopTimeoutMs: 1_000,
    });
    try {
      expect(
        await backend.status({ project_id: PROJECT_A, localPath: paths }),
      ).toMatchObject({
        state: "running",
        http_port: 12345,
      });
      await backend.stop({ project_id: PROJECT_A, localPath: paths });
      const stoppedStat = await readFile(`/proc/${pid}/stat`, "utf8").catch(
        () => undefined,
      );
      expect(
        stoppedStat == null ||
          stoppedStat.slice(stoppedStat.lastIndexOf(")") + 2).startsWith("Z"),
      ).toBe(true);
    } finally {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects relative runtime paths before starting", () => {
    expect(
      () =>
        new WorkspaceRuntimeBackend({
          client: {} as ConatClient,
          projectPath: "relative/projects",
          statePath: "/tmp/runtime",
          logsPath: "/tmp/logs",
          projectBin: projectBin(),
          conatServer: "http://127.0.0.1:1",
        }),
    ).toThrow("COCALC_PROJECT_PATH must be an absolute path");
  });
});
