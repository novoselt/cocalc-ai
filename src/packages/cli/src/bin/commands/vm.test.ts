/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Command } from "commander";
import {
  buildVmSshConfigBlock,
  parseTtlMinutes,
  registerVmCommand,
  removeVmSshConfigBlock,
  resolveVmRsyncEndpoint,
  vmListSummary,
  vmRsyncArgs,
  vmWaitProgress,
  volumeListSummary,
} from "./vm";

function harness() {
  const sshCalls: string[][] = [];
  const rsyncCalls: string[][] = [];
  const callbackResults: unknown[] = [];
  const ttlCalls: any[] = [];
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerVmCommand(program, {
    withContext: async (_command, _name, callback) => {
      const result = await callback({
        globals: {},
        hub: {
          compute: {
            getVm: async () => ({
              id: "vm-id",
              name: "build-vm",
              state: "ready",
              public_ip: "203.0.113.10",
              ssh_user: "ubuntu",
            }),
            setVmTtl: async (opts: any) => {
              ttlCalls.push(opts);
              return { id: "vm-id", name: "build-vm", ...opts };
            },
          },
        },
      });
      callbackResults.push(result);
      return result;
    },
    runSsh: (args) => sshCalls.push(args),
    runRsync: (args) => rsyncCalls.push(args),
  });
  return { program, sshCalls, rsyncCalls, callbackResults, ttlCalls };
}

describe("vm ttl", () => {
  it("parses human durations and extends an existing deadline", async () => {
    assert.equal(parseTtlMinutes("2h"), 120);
    const { program, ttlCalls } = harness();
    await program.parseAsync([
      "node",
      "cocalc",
      "vm",
      "ttl",
      "build-vm",
      "--extend",
      "2h",
    ]);
    assert.equal(ttlCalls[0]?.id_or_name, "build-vm");
    assert.equal(ttlCalls[0]?.extend_minutes, 120);
    assert.equal(typeof ttlCalls[0]?.idempotency_key, "string");
  });

  it("clears the deadline explicitly", async () => {
    const { program, ttlCalls } = harness();
    await program.parseAsync([
      "node",
      "cocalc",
      "vm",
      "ttl",
      "build-vm",
      "--clear",
    ]);
    assert.equal(ttlCalls[0]?.ttl_minutes, null);
  });
});

describe("vm ssh", () => {
  it("opens an interactive SSH session when no command is supplied", async () => {
    const { program, sshCalls, callbackResults } = harness();
    await program.parseAsync(["node", "cocalc", "vm", "ssh", "build-vm"]);
    assert.deepEqual(sshCalls[0]?.slice(-1), ["ubuntu@203.0.113.10"]);
    assert.deepEqual(callbackResults, [undefined]);
  });

  it("passes a remote command and option-like arguments through to SSH", async () => {
    const { program, sshCalls, callbackResults } = harness();
    await program.parseAsync([
      "node",
      "cocalc",
      "vm",
      "ssh",
      "build-vm",
      "ls",
      "-la",
    ]);
    assert.deepEqual(sshCalls[0]?.slice(-3), [
      "ubuntu@203.0.113.10",
      "ls",
      "-la",
    ]);
    assert.deepEqual(callbackResults, [undefined]);
  });
});

describe("vm rsync", () => {
  it("passes ordinary rsync options and resolves a destination VM", async () => {
    const { program, rsyncCalls, callbackResults } = harness();
    await program.parseAsync([
      "node",
      "cocalc",
      "vm",
      "rsync",
      "-az",
      "./src/",
      "build-vm:/work/src/",
    ]);
    assert.deepEqual(rsyncCalls[0]?.slice(-3), [
      "-az",
      "./src/",
      "ubuntu@203.0.113.10:/work/src/",
    ]);
    assert.deepEqual(callbackResults, [undefined]);
  });

  it("resolves a source VM endpoint", () => {
    const args = vmRsyncArgs(
      {
        id: "vm-id",
        name: "build-vm",
        state: "ready",
        public_ip: "203.0.113.10",
        ssh_user: "ubuntu",
      },
      ["-a", "build-vm:/work/dist/", "./dist/"],
      {},
    );
    assert.equal(args.at(-2), "ubuntu@203.0.113.10:/work/dist/");
    assert.equal(
      resolveVmRsyncEndpoint(["build-vm:/work", "."]).vm,
      "build-vm",
    );
  });

  it("rejects remote-to-remote and transport overrides", () => {
    assert.throws(
      () => resolveVmRsyncEndpoint(["one:/work", "two:/work"]),
      /exactly one VM endpoint/,
    );
    assert.throws(
      () =>
        vmRsyncArgs(
          {
            id: "vm-id",
            name: "build-vm",
            state: "ready",
            public_ip: "203.0.113.10",
          },
          ["-e", "ssh -A", ".", "build-vm:/work"],
          {},
        ),
      /use --identity/,
    );
  });
});

describe("vm list", () => {
  it("uses a compact operational summary by default", () => {
    assert.deepEqual(
      vmListSummary([
        {
          id: "vm-id",
          name: "build-vm",
          state: "ready",
          machine_type: "e2-standard-2",
          effective_pricing_model: "spot",
          zone: "us-central1-a",
          public_ip: "203.0.113.10",
          expires_at: "2026-08-04T00:00:00.000Z",
          project_id: "project-id",
          metadata: { deliberately: "omitted" },
        },
      ]),
      [
        {
          name: "build-vm",
          state: "ready",
          machine: "e2-standard-2",
          pricing: "spot",
          zone: "us-central1-a",
          ip: "203.0.113.10",
          expires: "2026-08-04T00:00:00.000Z",
          project: "project-id",
        },
      ],
    );
  });
});

describe("vm wait", () => {
  it("explains retryable Spot capacity recovery", () => {
    assert.match(
      vmWaitProgress({
        state: "recovering",
        zone: "us-central1-a",
        error: "ZONE_RESOURCE_POOL_EXHAUSTED_WITH_DETAILS",
        spot_recovery_state: {},
      }) ?? "",
      /Spot capacity is unavailable in us-central1-a; retrying automatically/,
    );
    assert.equal(vmWaitProgress({ state: "ready" }), undefined);
  });
});

describe("vm volume list", () => {
  it("uses a compact storage summary by default", () => {
    assert.deepEqual(
      volumeListSummary([
        {
          name: "build-cache",
          state: "ready",
          size_gb: 50,
          zone: "us-central1-a",
          attachment_state: "detached",
          attached_vm_id: null,
          monthly_price_per_gb: "0.100000",
        },
      ]),
      [
        {
          name: "build-cache",
          state: "ready",
          size_gb: 50,
          zone: "us-central1-a",
          attachment: "detached",
          vm: "",
          monthly_usd: 5,
        },
      ],
    );
  });
});

describe("vm ssh-config", () => {
  it("replaces only the matching managed block", () => {
    const oldBlock = buildVmSshConfigBlock({
      alias: "build-vm",
      hostname: "203.0.113.1",
      username: "ubuntu",
      identity: "/home/user/.ssh/id_ed25519",
    });
    const content = `Host personal\n  HostName example.com\n\n${oldBlock}`;
    const removed = removeVmSshConfigBlock(content, "build-vm");
    assert.equal(removed.removed, true);
    assert.match(removed.content, /Host personal/);
    assert.doesNotMatch(removed.content, /203\.0\.113\.1/);
  });

  it("writes a locked-down direct SSH entry", () => {
    const block = buildVmSshConfigBlock({
      alias: "build-vm",
      hostname: "203.0.113.10",
      username: "ubuntu",
      identity: "/home/user/.ssh/id_ed25519",
    });
    assert.match(block, /Host build-vm/);
    assert.match(block, /HostName 203\.0\.113\.10/);
    assert.match(block, /ForwardAgent no/);
    assert.match(block, /IdentitiesOnly yes/);
    assert.match(block, /StrictHostKeyChecking accept-new/);
  });
});
