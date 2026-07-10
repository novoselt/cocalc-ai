/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { isRecoverableFilesystemClientError } from "./filesystem-client";

describe("isRecoverableFilesystemClientError", () => {
  it("treats project-host info bootstrap timeouts as recoverable", () => {
    expect(
      isRecoverableFilesystemClientError(
        new Error('once: timeout of 4000ms waiting for "info"'),
      ),
    ).toBe(true);
  });

  it("treats failed project-host fetches as recoverable", () => {
    expect(
      isRecoverableFilesystemClientError(new TypeError("Failed to fetch")),
    ).toBe(true);
  });
});
