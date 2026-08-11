/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { after, before, getPool } from "@cocalc/server/test";
import { uuid } from "@cocalc/util/misc";
import createCredit from "./create-credit";

beforeAll(async () => {
  await before({ noConat: true });
}, 15_000);
afterAll(after);

describe("createCredit", () => {
  it("posts credits in whole cents", async () => {
    const account_id = uuid();
    await getPool().query(
      "INSERT INTO accounts (account_id, email_address) VALUES ($1, $2)",
      [account_id, `${account_id}@example.com`],
    );

    const purchase_id = await createCredit({
      account_id,
      amount: "1.005",
    });
    const { rows } = await getPool().query(
      "SELECT cost FROM purchases WHERE id=$1",
      [purchase_id],
    );

    expect(rows[0].cost).toBe("-1.0100000000");
  });
});
