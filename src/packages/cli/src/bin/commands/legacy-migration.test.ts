import assert from "node:assert/strict";
import test from "node:test";

import { Command } from "commander";

import { registerLegacyMigrationCommand } from "./legacy-migration";

test("legacy public-share catch-up defaults to one dry-run batch", async () => {
  const calls: any[] = [];
  let result: any;
  const program = new Command();
  registerLegacyMigrationCommand(program, {
    isValidUUID: () => true,
    hubCallByName: async (_ctx, name, args) => {
      calls.push({ name, opts: args[0] });
      return {
        committed: false,
        projects: [
          {
            legacy_project_id: "00000000-0000-4000-8000-000000000001",
            imported: 0,
            skipped: 0,
          },
        ],
        has_more: true,
        next_after_legacy_project_id: "00000000-0000-4000-8000-000000000001",
      };
    },
    withContext: async (_command, _label, fn) => {
      result = await fn({ timeoutMs: 30_000 });
      return result;
    },
  });

  await program.parseAsync([
    "node",
    "test",
    "legacy-migration",
    "public-shares",
    "replay-restored",
    "--reason",
    "deployment catch-up",
  ]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "legacyMigration.adminReplayRestoredPublicPaths");
  assert.deepEqual(calls[0].opts, {
    after_legacy_project_id: undefined,
    limit: 25,
    reason: "deployment catch-up",
    support_reference: undefined,
    commit: false,
  });
  assert.equal(result.committed, false);
  assert.equal(result.has_more, true);
});

test("legacy public-share catch-up advances through every committed batch", async () => {
  const calls: any[] = [];
  let result: any;
  const cursors = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
  ];
  const program = new Command();
  registerLegacyMigrationCommand(program, {
    isValidUUID: () => true,
    hubCallByName: async (_ctx, name, args) => {
      calls.push({ name, opts: args[0] });
      const index = calls.length - 1;
      return {
        committed: true,
        projects: [
          {
            legacy_project_id: cursors[index],
            imported: index + 1,
            skipped: index,
          },
        ],
        has_more: index === 0,
        next_after_legacy_project_id: cursors[index],
      };
    },
    withContext: async (_command, _label, fn) => {
      result = await fn({ timeoutMs: 30_000 });
      return result;
    },
  });

  await program.parseAsync([
    "node",
    "test",
    "legacy-migration",
    "public-shares",
    "replay-restored",
    "--reason",
    "deployment catch-up",
    "--support-reference",
    "deploy-2026-08-06",
    "--batch-size",
    "10",
    "--all",
    "--commit",
  ]);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].opts.after_legacy_project_id, undefined);
  assert.equal(
    calls[1].opts.after_legacy_project_id,
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(calls[1].opts.commit, true);
  assert.equal(calls[1].opts.limit, 10);
  assert.equal(calls[1].opts.support_reference, "deploy-2026-08-06");
  assert.equal(result.batches, 2);
  assert.equal(result.project_count, 2);
  assert.equal(result.imported, 3);
  assert.equal(result.skipped, 1);
  assert.equal(result.has_more, false);
});
