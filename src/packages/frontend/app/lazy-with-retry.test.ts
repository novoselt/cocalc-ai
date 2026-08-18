/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { loadWithRetry } from "./lazy-with-retry";

describe("loadWithRetry", () => {
  it("returns the first successful result", async () => {
    const loader = jest.fn(async () => "loaded");

    await expect(
      loadWithRetry(loader, { name: "test panel", retryDelayMs: 0 }),
    ).resolves.toBe("loaded");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("retries a transient chunk failure", async () => {
    const loader = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error("network interrupted"))
      .mockResolvedValue("loaded");

    await expect(
      loadWithRetry(loader, { name: "test panel", retryDelayMs: 0 }),
    ).resolves.toBe("loaded");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("preserves the final error as the cause", async () => {
    const chunkError = new Error("chunk unavailable");
    const loader = jest.fn(async () => {
      throw chunkError;
    });

    await expect(
      loadWithRetry(loader, {
        attempts: 2,
        name: "test panel",
        retryDelayMs: 0,
      }),
    ).rejects.toMatchObject({
      cause: chunkError,
      message: "Failed to load test panel after 2 attempts: chunk unavailable",
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
