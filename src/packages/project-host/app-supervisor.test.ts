/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveSupervisedCommand,
  superviseApp,
  supervisorExitCode,
} from "./app-supervisor";
import { getProjectHostActivitySnapshot } from "./health-progress";

describe("project-host app supervisor", () => {
  const originalEnv = { ...process.env };
  let dataDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    dataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "cocalc-project-host-app-supervisor-"),
    );
    process.env.COCALC_DATA = dataDir;
    process.env.COCALC_PROJECT_HOST_SUPERVISED_COMMAND = process.execPath;
    process.env.COCALC_PROJECT_HOST_SUPERVISED_CWD = dataDir;
    process.env.COCALC_PROJECT_HOST_SUPERVISED_VERSION = "test-version";
    process.env.COCALC_PROJECT_HOST_APP_PID_PATH = path.join(
      dataDir,
      "project-host-app.pid",
    );
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function events(): any[] {
    return fs
      .readFileSync(path.join(dataDir, "supervision-events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  it("records a normal child exit and removes the app pid file", async () => {
    process.env.COCALC_PROJECT_HOST_SUPERVISED_ARGS = JSON.stringify([
      "-e",
      "process.exit(7)",
    ]);

    const result = await superviseApp();

    expect(result).toMatchObject({ code: 7, signal: null });
    expect(supervisorExitCode(result)).toBe(7);
    expect(fs.existsSync(process.env.COCALC_PROJECT_HOST_APP_PID_PATH!)).toBe(
      false,
    );
    expect(events().at(-1)).toMatchObject({
      source: "daemon",
      component: "project-host",
      action: "process_exit",
      selected_version: "test-version",
      metadata: {
        exit_code: 7,
        signal: null,
        supervisor_pid: process.pid,
      },
    });
  });

  it("records the signal that killed the child", async () => {
    process.env.COCALC_PROJECT_HOST_SUPERVISED_ARGS = JSON.stringify([
      "-e",
      'process.kill(process.pid, "SIGSEGV")',
    ]);

    const result = await superviseApp();

    expect(result).toMatchObject({ code: null, signal: "SIGSEGV" });
    expect(supervisorExitCode(result)).toBeGreaterThanOrEqual(128);
    expect(events().at(-1)).toMatchObject({
      action: "process_exit",
      pid: result.childPid,
      metadata: {
        exit_code: null,
        signal: "SIGSEGV",
        supervisor_pid: process.pid,
      },
    });
  });

  it("attributes app activity to the durable supervisor pid", () => {
    process.env.COCALC_PROJECT_HOST_SUPERVISOR_PID = "4242";

    expect(getProjectHostActivitySnapshot().pid).toBe(4242);
  });

  it("leaves the app command unchanged when core capture is disabled", () => {
    expect(resolveSupervisedCommand("/app", ["serve"])).toEqual({
      command: "/app",
      args: ["serve"],
    });
  });

  it("applies a bounded app-only core limit when capture is enabled", () => {
    process.env.COCALC_PROJECT_HOST_APP_CORE_DUMPS = "1";
    process.env.COCALC_PROJECT_HOST_APP_CORE_LIMIT_BYTES = "1048576";

    expect(resolveSupervisedCommand("/app", ["serve"])).toEqual({
      command: "/usr/bin/prlimit",
      args: ["--core=1048576:1048576", "--", "/app", "serve"],
    });
  });

  it("rejects an app core limit above the hard cap", () => {
    process.env.COCALC_PROJECT_HOST_APP_CORE_DUMPS = "1";
    process.env.COCALC_PROJECT_HOST_APP_CORE_LIMIT_BYTES = "1073741825";

    expect(() => resolveSupervisedCommand("/app", [])).toThrow(
      "must be an integer between 1 and 1073741824",
    );
  });
});
