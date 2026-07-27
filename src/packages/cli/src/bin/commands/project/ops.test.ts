import assert from "node:assert/strict";
import test from "node:test";

import {
  annotateProjectRehomeDrainDanger,
  assertProjectLogRuntimeAvailable,
  assertProjectRehomeConfirmed,
  getMovePlacementFallbackTimeoutMs,
  readProjectLogPage,
} from "./ops";
import {
  buildManagedProjectSshConfigLines,
  managedProjectSshOptionArgs,
} from "./ssh-config";

test("managed project ssh config accepts a first-use host key in batch mode", () => {
  const lines = buildManagedProjectSshConfigLines({
    alias: "project-id",
    hostName: "ssh.example.com",
    username: "project-id",
    proxyCommand: "cloudflared access ssh --hostname %h",
    identityFile: "/home/user/.ssh/id_ed25519",
  });

  assert.deepEqual(lines, [
    "Host project-id",
    "  HostName ssh.example.com",
    "  User project-id",
    "  ProxyCommand cloudflared access ssh --hostname %h",
    "  StrictHostKeyChecking accept-new",
    "  ServerAliveInterval 15",
    "  ServerAliveCountMax 2",
    "  IdentityFile /home/user/.ssh/id_ed25519",
    "  IdentitiesOnly yes",
    "  BatchMode yes",
    "  PreferredAuthentications publickey",
    "  PasswordAuthentication no",
    "  KbdInteractiveAuthentication no",
  ]);
  assert.ok(
    lines.indexOf("  StrictHostKeyChecking accept-new") <
      lines.indexOf("  BatchMode yes"),
  );
});

test("one-shot project ssh commands use the same noninteractive host-key policy", () => {
  assert.deepEqual(managedProjectSshOptionArgs(), [
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    "-o",
    "BatchMode=yes",
    "-o",
    "PreferredAuthentications=publickey",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "KbdInteractiveAuthentication=no",
  ]);
});

test("getMovePlacementFallbackTimeoutMs preserves the full timeout for timed out move waits", () => {
  assert.equal(
    getMovePlacementFallbackTimeoutMs(
      { status: "running", timedOut: true },
      1_800_000,
    ),
    1_800_000,
  );
});

test("getMovePlacementFallbackTimeoutMs caps explicit move failures to a short placement check", () => {
  assert.equal(
    getMovePlacementFallbackTimeoutMs(
      { status: "failed", timedOut: false },
      1_800_000,
    ),
    10_000,
  );
});

test("getMovePlacementFallbackTimeoutMs respects shorter command timeouts", () => {
  assert.equal(
    getMovePlacementFallbackTimeoutMs(
      { status: "failed", timedOut: false },
      5_000,
    ),
    5_000,
  );
});

test("assertProjectRehomeConfirmed refuses rehome without --yes", () => {
  assert.throws(
    () =>
      assertProjectRehomeConfirmed({
        project_id: "project-id",
        dest_bay_id: "bay-2",
      }),
    /without --yes/,
  );
  assert.doesNotThrow(() =>
    assertProjectRehomeConfirmed({
      project_id: "project-id",
      dest_bay_id: "bay-2",
      yes: true,
      unsafeRehome: true,
    }),
  );
  assert.throws(
    () =>
      assertProjectRehomeConfirmed({
        project_id: "project-id",
        dest_bay_id: "bay-2",
        yes: true,
      }),
    /SQL side tables.*--unsafe-rehome/,
  );
});

test("annotateProjectRehomeDrainDanger explains non-portable side-table risk", () => {
  const result = annotateProjectRehomeDrainDanger({
    source_bay_id: "bay-1",
    dest_bay_id: "bay-2",
    dry_run: true,
    candidate_count: 1,
    side_table_preflight: {
      portable_tables: [],
      ignored_tables: ["patches"],
      non_portable_tables: [
        {
          table: "project_secrets",
          status: "requires_table_specific_portability",
          reason: "encrypted project secrets need explicit copy semantics",
        },
      ],
      summary:
        "Project rehome does not preserve 1 project-owned SQL side table.",
    },
  });

  assert.equal(
    result.rehome_danger.severity,
    "unsafe_non_portable_project_side_tables",
  );
  assert.match(result.rehome_danger.consequence, /leave these.*behind/);
  assert.deepEqual(result.rehome_danger.ignored_tables, ["patches"]);
  assert.equal(
    result.rehome_danger.non_portable_tables[0]?.table,
    "project_secrets",
  );
  assert.equal(result.rehome_danger.write_requires, "--write --unsafe-rehome");
  assert.match(
    result.rehome_danger.required_operator_workflow.join("\n"),
    /dry-run.*side_table_preflight.*--write --unsafe-rehome/s,
  );
});

test("assertProjectLogRuntimeAvailable rejects known non-runtime states", () => {
  assert.doesNotThrow(() =>
    assertProjectLogRuntimeAvailable({ project: { state: null } }),
  );
  assert.doesNotThrow(() =>
    assertProjectLogRuntimeAvailable({
      project: { state: { state: "running" } },
    }),
  );
  assert.throws(
    () =>
      assertProjectLogRuntimeAvailable({
        project: { state: { state: "opened" } },
      }),
    /project activity log is unavailable because the project is opened/,
  );
});

test("readProjectLogPage deduplicates by id and returns newest rows first", async () => {
  async function* getAll() {
    yield {
      seq: 1,
      time: Date.parse("2026-04-11T20:00:00.000Z"),
      mesg: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        project_id: "project-id",
        account_id: "account-a",
        event: { event: "older" },
      },
    };
    yield {
      seq: 2,
      time: Date.parse("2026-04-11T21:00:00.000Z"),
      mesg: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        project_id: "project-id",
        account_id: "account-a",
        event: { event: "newer" },
      },
    };
    yield {
      seq: 3,
      time: Date.parse("2026-04-11T20:30:00.000Z"),
      mesg: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        project_id: "project-id",
        account_id: "account-b",
        event: { event: "other" },
      },
    };
  }

  const page = await readProjectLogPage({
    stream: { getAll },
    project_id: "project-id",
    limit: 1,
  });

  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0]?.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
  assert.deepEqual(page.entries[0]?.event, { event: "newer" });
  assert.equal(page.has_more, true);
});
