/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Command } from "commander";

import type { HostExamState } from "@cocalc/conat/hub/api/hosts";
import { registerHostExamCommands } from "./host-exam";

const host = {
  id: "00000000-1000-4000-8000-000000000001",
  name: "exam-test",
  host_cpu_count: 16,
  host_ram_gb: 64,
};

function initialState(): HostExamState {
  return {
    eligible: true,
    config: {
      host_id: host.id,
      enabled: false,
      title: "Exam Scratchpad",
      hostname: "exam-test.example.test",
      generation: 1,
      max_projects: 100,
      project_cpu: 1,
      project_memory_mb: 2_000,
      project_disk_mb: 5_000,
      project_ttl_minutes: 360,
      cleanup_grace_minutes: 10,
      terminal_enabled: false,
      network_mode: "disabled",
      created_at: "2026-07-31T00:00:00.000Z",
      updated_at: "2026-07-31T00:00:00.000Z",
      created_by: "account-1",
      updated_by: "account-1",
    },
  };
}

function makeHarness() {
  let state = initialState();
  let output: any;
  const calls: Record<string, any[]> = {};
  const record = (name: string, opts: any) => {
    calls[name] ??= [];
    calls[name].push(opts);
  };
  const hub = {
    hosts: {
      getHostExamState: async (opts: any) => {
        record("status", opts);
        return state;
      },
      setHostExamConfig: async (opts: any) => {
        record("configure", opts);
        state = {
          ...state,
          config: {
            ...state.config!,
            ...opts.config,
            generation: state.config!.generation + 1,
          },
        };
        return state;
      },
      createHostExamRun: async (opts: any) => {
        record("prepare", opts);
        state = {
          ...state,
          run: {
            run_id: "00000000-2000-4000-8000-000000000002",
            host_id: host.id,
            config_generation: state.config!.generation,
            status: "ready",
            rootfs_image: opts.rootfs_image,
            rootfs_digest: "sha256:exam",
            run_quota: {
              cpu_limit: 1,
              memory_limit: 2_000,
              disk_quota: 5_000,
              pids_limit: 512,
            },
            max_projects: state.config!.max_projects,
            terminal_enabled: state.config!.terminal_enabled,
            network_mode: "disabled",
            scheduled_stop_at: opts.scheduled_stop_at,
            stop_host_at_deadline: opts.stop_host_at_deadline,
            owner_account_id: "account-1",
            created_at: "2026-07-31T00:00:00.000Z",
            updated_at: "2026-07-31T00:00:00.000Z",
            created_by: "account-1",
          },
          runtime: {
            run_id: "00000000-2000-4000-8000-000000000002",
            status: "ready",
            admission_open: false,
            active_projects: 0,
          },
        };
        return { ...state, token: "initial-token" };
      },
      openHostExamRun: async (opts: any) => {
        record("open", opts);
        state = {
          ...state,
          run: { ...state.run!, status: "open" },
          runtime: { ...state.runtime!, status: "open", admission_open: true },
        };
        return state;
      },
      rotateHostExamToken: async (opts: any) => {
        record("rotate", opts);
        return { ...state, token: "rotated-token" };
      },
      updateHostExamDeadline: async (opts: any) => {
        record("deadline", opts);
        state = {
          ...state,
          run: {
            ...state.run!,
            scheduled_stop_at: opts.scheduled_stop_at,
            stop_host_at_deadline: opts.stop_host_at_deadline,
          },
        };
        return state;
      },
      stopAndEraseHostExamRun: async (opts: any) => {
        record("end", opts);
        state = {
          ...state,
          run: { ...state.run!, status: "stopped" },
          runtime: {
            ...state.runtime!,
            status: "stopped",
            admission_open: false,
            active_projects: 0,
          },
        };
        return state;
      },
    },
  };

  async function run(args: string[]) {
    const program = new Command();
    const hostCommand = program.command("host");
    registerHostExamCommands({
      hostCommand,
      deps: {
        resolveHost: async () => host,
        withContext: async (_command: Command, _label: string, action: any) => {
          output = await action({ hub });
        },
      },
    });
    await program.parseAsync(["node", "test", "host", "exam", ...args]);
    return output;
  }

  return { calls, run };
}

describe("host exam commands", () => {
  it("exposes and executes the complete instructor lifecycle", async () => {
    const harness = makeHarness();

    const initial = await harness.run(["status", "exam-test"]);
    assert.equal(initial.student_url, "https://exam-test.example.test");
    assert.equal(initial.admission_url, null);
    assert.equal(initial.documentation, "/app-docs/hosts/exam-scratchpads");
    assert.equal(harness.calls.status.at(-1).timeout, 30_000);

    const configured = await harness.run([
      "configure",
      "exam-test",
      "--enable",
      "--title",
      "Linear Algebra Scratchpad",
      "--max-projects",
      "20",
      "--project-cpu",
      "2",
      "--project-memory-mb",
      "2500",
      "--project-disk-mb",
      "6000",
      "--maximum-run-minutes",
      "240",
      "--cleanup-grace-minutes",
      "12",
      "--allow-terminal",
    ]);
    const configureCall = harness.calls.configure.at(-1);
    assert.equal(configureCall.id, host.id);
    assert.equal(configureCall.timeout, 120_000);
    assert.deepEqual(
      {
        enabled: configureCall.config.enabled,
        title: configureCall.config.title,
        max_projects: configureCall.config.max_projects,
        terminal_enabled: configureCall.config.terminal_enabled,
        network_mode: configureCall.config.network_mode,
      },
      {
        enabled: true,
        title: "Linear Algebra Scratchpad",
        max_projects: 20,
        terminal_enabled: true,
        network_mode: "disabled",
      },
    );
    assert.deepEqual(configured.capacity_guidance, {
      maximum_projects: 20,
      recommended_cpu: 8,
      recommended_ram_gb: 14,
      actual_cpu: 16,
      actual_ram_gb: 64,
    });

    const deleteAt = "2026-07-31T23:00:00.000Z";
    const prepared = await harness.run([
      "prepare",
      "exam-test",
      "--rootfs",
      "cocalc.local/rootfs/exam",
      "--delete-at",
      deleteAt,
      "--keep-host-running",
      "--idempotency-key",
      "exam-test-prepare",
    ]);
    assert.equal(
      prepared.admission_url,
      "https://exam-test.example.test/#token=initial-token",
    );
    assert.equal(prepared.token, "initial-token");
    assert.equal(prepared.run.status, "ready");
    const prepareCall = harness.calls.prepare.at(-1);
    assert.equal(prepareCall.timeout, 720_000);
    assert.equal(prepareCall.stop_host_at_deadline, false);
    assert.equal(prepareCall.idempotency_key, "exam-test-prepare");

    assert.equal(
      (await harness.run(["rotate-token", "exam-test"])).token,
      "rotated-token",
    );
    assert.equal((await harness.run(["open", "exam-test"])).run.status, "open");
    assert.equal(harness.calls.open.at(-1).timeout, 120_000);
    await assert.rejects(
      harness.run(["rotate-token", "exam-test"]),
      /before admission opens/,
    );

    const newDeleteAt = "2026-07-31T23:30:00.000Z";
    await harness.run([
      "deadline",
      "exam-test",
      "--delete-at",
      newDeleteAt,
      "--keep-host-running",
    ]);
    const deadlineCall = harness.calls.deadline.at(-1);
    assert.equal(deadlineCall.scheduled_stop_at, newDeleteAt);
    assert.equal(deadlineCall.stop_host_at_deadline, false);
    assert.equal(deadlineCall.timeout, 120_000);

    const ended = await harness.run([
      "end",
      "exam-test",
      "--keep-host-running",
      "--yes",
    ]);
    assert.equal(ended.run.status, "stopped");
    assert.equal(harness.calls.end.at(-1).stop_host, false);
    assert.equal(harness.calls.end.at(-1).timeout, 720_000);
  });

  it("requires explicit confirmation before erasing exam projects", async () => {
    const harness = makeHarness();
    await harness.run([
      "configure",
      "exam-test",
      "--enable",
      "--max-projects",
      "1",
    ]);
    await harness.run([
      "prepare",
      "exam-test",
      "--rootfs",
      "cocalc.local/rootfs/exam",
      "--delete-at",
      "2026-07-31T23:00:00.000Z",
    ]);
    await assert.rejects(harness.run(["end", "exam-test"]), /without --yes/);
    assert.equal(harness.calls.end, undefined);
  });
});
