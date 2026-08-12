/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { storagePath } from "./core-stream";

describe("core stream persistence paths", () => {
  it("constructs POSIX protocol paths", () => {
    expect(storagePath({ name: "blobs" })).toBe("hub/blobs");
    expect(
      storagePath({
        account_id: "00000000-1000-4000-8000-000000000001",
        name: "account-feed",
      }),
    ).toBe("accounts/00000000-1000-4000-8000-000000000001/account-feed");
  });
});
