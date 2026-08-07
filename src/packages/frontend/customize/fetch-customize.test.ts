/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fetchCustomize } from "./fetch-customize";

const originalFetch = global.fetch;

describe("fetchCustomize", () => {
  afterEach(() => {
    jest.useRealTimers();
    if (originalFetch == null) {
      delete (global as any).fetch;
    } else {
      global.fetch = originalFetch;
    }
  });

  it("returns a valid site configuration response", async () => {
    const customize = { configuration: { site_name: "CoCalc" } };
    (global as any).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => customize,
    }));

    await expect(fetchCustomize({ url: "/customize" })).resolves.toBe(
      customize,
    );
  });

  it("rejects an invalid successful response", async () => {
    (global as any).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ error: "not configured" }),
    }));

    await expect(fetchCustomize({ url: "/customize" })).rejects.toThrow(
      "site configuration response is invalid",
    );
  });

  it("times out a request whose response body never completes", async () => {
    jest.useFakeTimers();
    (global as any).fetch = jest.fn(
      async (_url: string, { signal }: { signal?: AbortSignal } = {}) =>
        ({
          ok: true,
          json: async () =>
            await new Promise((_resolve, reject) => {
              signal?.addEventListener("abort", () =>
                reject(new Error("aborted")),
              );
            }),
        }) as Response,
    );

    const request = expect(
      fetchCustomize({ url: "/customize", timeout_ms: 100 }),
    ).rejects.toThrow("site configuration request timed out");
    await jest.advanceTimersByTimeAsync(100);
    await request;
  });
});
