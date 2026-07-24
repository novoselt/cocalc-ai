/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { AUTOBALANCE_DEFAULTS } from "./accounts";
import { SCHEMA } from "./types";

describe("automatic deposit defaults", () => {
  it("uses a practical default deposit amount", () => {
    expect(AUTOBALANCE_DEFAULTS.amount).toBe(50);
  });
});

describe("accounts user-query schema", () => {
  it("does not expose automatic deposits through generic account writes", () => {
    const fields = SCHEMA.accounts.user_query?.set?.fields as
      | Record<string, unknown>
      | undefined;

    expect(fields?.auto_balance).toBeUndefined();
  });
});
