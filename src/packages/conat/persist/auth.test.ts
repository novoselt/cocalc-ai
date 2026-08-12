/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { assertHasWritePermission, isNormalizedStoragePath } from "./auth";

const ACCOUNT_ID = "00000000-1000-4000-8000-000000000001";
const SERVICE = "persist-test";
const SUBJECT = `${SERVICE}.account-${ACCOUNT_ID}`;

describe("persistent storage protocol paths", () => {
  it("accepts canonical POSIX paths on every host platform", () => {
    expect(() =>
      assertHasWritePermission({
        subject: SUBJECT,
        path: `accounts/${ACCOUNT_ID}/account-feed`,
        service: SERVICE,
      }),
    ).not.toThrow();
  });

  it("rejects traversal", () => {
    expect(() =>
      assertHasWritePermission({
        subject: SUBJECT,
        path: `accounts/${ACCOUNT_ID}/folder/../account-feed`,
        service: SERVICE,
      }),
    ).toThrow("is not normalized");
  });

  it("treats backslashes according to host filename semantics", () => {
    const path = `accounts/${ACCOUNT_ID}/dko-[weird\\name]`;
    expect(isNormalizedStoragePath(path, "linux")).toBe(true);
    expect(isNormalizedStoragePath(path, "darwin")).toBe(true);
    expect(isNormalizedStoragePath(path, "browser")).toBe(true);
    expect(isNormalizedStoragePath(path, "win32")).toBe(false);
  });
});
