/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { after, before, getPool } from "@cocalc/server/test";
import { uuid } from "@cocalc/util/misc";
import {
  attestReleasedLroDedupeSuccesses,
  createLro,
  ensureLroSchema,
  expireDueLros,
  getLro,
  listLrosByDedupe,
  updateLro,
} from "./lro-db";

beforeAll(async () => {
  await before();
}, 15_000);
afterAll(after);

describe("LRO database maintenance integration", () => {
  it("expires only bounded due active rows", async () => {
    const kind = `expiration-test-${uuid()}`;
    const scope_id = uuid();
    const first = await createLro({
      kind,
      scope_type: "project",
      scope_id,
      expires_at: new Date(Date.now() - 60_000),
    });
    const second = await createLro({
      kind,
      scope_type: "project",
      scope_id,
      expires_at: new Date(Date.now() - 30_000),
    });
    const future = await createLro({
      kind,
      scope_type: "project",
      scope_id,
      expires_at: new Date(Date.now() + 60_000),
    });

    await expect(expireDueLros({ kind, limit: 1 })).resolves.toHaveLength(1);
    await expect(expireDueLros({ kind, limit: 1 })).resolves.toHaveLength(1);
    await expect(expireDueLros({ kind, limit: 1 })).resolves.toHaveLength(0);
    await expect(getLro(first.op_id)).resolves.toMatchObject({
      status: "expired",
    });
    await expect(getLro(second.op_id)).resolves.toMatchObject({
      status: "expired",
    });
    await expect(getLro(future.op_id)).resolves.toMatchObject({
      status: "queued",
    });
  });

  it("installs the partial expiration index", async () => {
    await ensureLroSchema();
    const { rows } = await getPool().query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname='lro_expiry_idx'`,
    );
    expect(rows[0]?.indexdef).toContain("expires_at");
    expect(rows[0]?.indexdef).toContain("dismissed_at IS NULL");
  });

  it("lists all operations for a durable dedupe identity newest first", async () => {
    const scope_id = uuid();
    const dedupe_key = `archive-final:${uuid()}`;
    const first = await createLro({
      kind: "project-backup",
      scope_type: "project",
      scope_id,
      dedupe_key,
    });
    await updateLro({
      op_id: first.op_id,
      status: "succeeded",
      result: { id: "backup-1", generation: 1 },
    });
    await getPool().query(
      `UPDATE long_running_operations
          SET created_at = created_at - interval '1 minute'
        WHERE op_id=$1`,
      [first.op_id],
    );
    const second = await createLro({
      kind: "project-backup",
      scope_type: "project",
      scope_id,
      dedupe_key,
    });

    await expect(
      listLrosByDedupe({
        scope_type: "project",
        scope_id,
        dedupe_key,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ op_id: second.op_id, status: "queued" }),
      expect.objectContaining({ op_id: first.op_id, status: "succeeded" }),
    ]);
  });

  it("attests every successful operation released under the dedupe lock", async () => {
    const scope_id = uuid();
    const dedupe_key = `archive-release:${uuid()}`;
    const succeeded = await createLro({
      kind: "project-backup",
      scope_type: "project",
      scope_id,
      dedupe_key,
    });
    await updateLro({
      op_id: succeeded.op_id,
      status: "succeeded",
      result: { id: "backup-release", generation: 17 },
    });
    const uncertain = await createLro({
      kind: "project-backup",
      scope_type: "project",
      scope_id,
      dedupe_key,
    });
    await updateLro({
      op_id: uncertain.op_id,
      status: "failed",
      result: { archive_freeze_recovery: "uncertain" },
    });

    await expect(
      attestReleasedLroDedupeSuccesses({
        scope_type: "project",
        scope_id,
        dedupe_key,
        expected_result_id: "backup-release",
        expected_generation: 18,
      }),
    ).rejects.toThrow("does not match the final backup");
    await expect(getLro(succeeded.op_id)).resolves.toMatchObject({
      result: { id: "backup-release", generation: 17 },
    });

    await expect(
      attestReleasedLroDedupeSuccesses({
        scope_type: "project",
        scope_id,
        dedupe_key,
        expected_result_id: "backup-release",
        expected_generation: 17,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op_id: succeeded.op_id }),
        expect.objectContaining({ op_id: uncertain.op_id }),
      ]),
    );
    await expect(getLro(succeeded.op_id)).resolves.toMatchObject({
      status: "succeeded",
      result: {
        id: "backup-release",
        generation: 17,
        archive_freeze_recovery: "released",
      },
    });
  });
});
