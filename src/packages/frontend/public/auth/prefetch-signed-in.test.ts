/** @jest-environment jsdom */

import {
  prefetchSignedInShell,
  shouldPrefetchSignedInShell,
} from "./prefetch-signed-in";

const originalFetch = globalThis.fetch;

describe("signed-in shell authentication prefetch", () => {
  beforeEach(() => {
    document.head
      .querySelectorAll('link[rel="prefetch"]')
      .forEach((element) => element.remove());
    localStorage.clear();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    if (originalFetch == null) {
      delete (globalThis as any).fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
  });

  it("suppresses speculative work for constrained clients", () => {
    expect(
      shouldPrefetchSignedInShell({ documentHidden: false, saveData: true }),
    ).toBe(false);
    expect(
      shouldPrefetchSignedInShell({
        documentHidden: false,
        downlinkMbps: 1,
      }),
    ).toBe(false);
    expect(
      shouldPrefetchSignedInShell({
        documentHidden: false,
        hardwareConcurrency: 2,
      }),
    ).toBe(false);
    expect(
      shouldPrefetchSignedInShell({
        documentHidden: false,
        hardwareConcurrency: 8,
      }),
    ).toBe(true);
  });

  it("prefetches only the current manifest's immutable scripts", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '<script defer src="load-abc.js"></script><script defer src="app-def.js"></script>',
    } as Response) as jest.Mock;

    await prefetchSignedInShell();

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/static/app.html" }),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(
      [...document.head.querySelectorAll('link[rel="prefetch"]')].map(
        (link) => (link as HTMLLinkElement).href,
      ),
    ).toEqual([
      `${window.location.origin}/static/load-abc.js`,
      `${window.location.origin}/static/app-def.js`,
    ]);
  });
});
