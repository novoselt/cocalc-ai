/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { after, before, getPool } from "@cocalc/server/test";
import { uuid } from "@cocalc/util/misc";
import { createLro, ensureLroSchema, expireDueLros, getLro } from "./lro-db";

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
});
