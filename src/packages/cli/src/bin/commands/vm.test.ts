/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Command } from "commander";
import {
  buildVmSshConfigBlock,
  registerVmCommand,
  removeVmSshConfigBlock,
  vmListSummary,
} from "./vm";

function harness() {
  const sshCalls: string[][] = [];
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerVmCommand(program, {
    withContext: async (_command, _name, callback) =>
      await callback({
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
          },
        },
      }),
    runSsh: (args) => sshCalls.push(args),
  });
  return { program, sshCalls };
}

describe("vm ssh", () => {
  it("opens an interactive SSH session when no command is supplied", async () => {
    const { program, sshCalls } = harness();
    await program.parseAsync(["node", "cocalc", "vm", "ssh", "build-vm"]);
    assert.deepEqual(sshCalls[0]?.slice(-1), ["ubuntu@203.0.113.10"]);
  });

  it("passes a remote command and option-like arguments through to SSH", async () => {
    const { program, sshCalls } = harness();
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
