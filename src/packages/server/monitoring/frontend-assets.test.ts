import {
  parseFrontendAssetHistory,
  probeFrontendAssets,
} from "./frontend-assets";

test("parses current and previous safe content-addressed assets", () => {
  expect(
    parseFrontendAssetHistory({
      schema: 1,
      builds: [
        { assets: ["app-0123456789abcdef.js"] },
        { assets: ["app-fedcba9876543210.js"] },
      ],
    }),
  ).toEqual({
    builds: 2,
    assets: ["app-0123456789abcdef.js", "app-fedcba9876543210.js"],
  });
  expect(() =>
    parseFrontendAssetHistory({
      schema: 1,
      builds: [{ assets: ["../app-0123456789abcdef.js"] }],
    }),
  ).toThrow("unsafe path");
});

test("retries and reports unavailable retained assets", async () => {
  const requests: { method: string; url: string }[] = [];
  const fetchImpl = jest.fn(async (input, init) => {
    const url = `${input}`;
    const method = `${init?.method}`;
    requests.push({ method, url });
    if (url.includes("frontend-build-history.json")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          schema: 1,
          builds: [{ assets: ["app-0123456789abcdef.js"] }],
        }),
      } as Response;
    }
    return { ok: false, status: 404 } as Response;
  }) as typeof fetch;

  await expect(
    probeFrontendAssets({ origin: "https://example.test", fetchImpl }),
  ).resolves.toEqual({
    origin: "https://example.test",
    builds: 1,
    assets: 1,
    failures: ["app-0123456789abcdef.js: HTTP 404"],
  });
  expect(requests.map(({ method }) => method)).toEqual(["GET", "HEAD", "HEAD"]);
});
