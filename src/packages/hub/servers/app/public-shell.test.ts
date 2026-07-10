import { renderPublicShell } from "./public-shell";

jest.mock("@cocalc/database/settings/customize", () => ({
  __esModule: true,
  default: jest.fn(async () => ({ siteName: "CoCalc" })),
}));

describe("public shell rendering", () => {
  it("canonicalizes static shell target URLs to the clean public URL", async () => {
    const body = await renderPublicShell({
      get: (name: string) =>
        name.toLowerCase() === "host" ? "cocalc.ai" : undefined,
      path: "/static/public.html",
      protocol: "https",
      query: { target: "/features/jupyter-notebook?x=1" },
      url: "/static/public.html?target=%2Ffeatures%2Fjupyter-notebook%3Fx%3D1",
    } as any);

    expect(body).toContain(
      'href="https://cocalc.ai/features/jupyter-notebook" rel="canonical"',
    );
    expect(body).toContain(
      'data-cocalc-public-route-meta="description" name="description"',
    );
    expect(body).not.toContain(
      'href="https://cocalc.ai/static/public.html" rel="canonical"',
    );
  });

  it("emits exactly one title and no leftover head markers", async () => {
    const body = await renderPublicShell({
      get: (name: string) =>
        name.toLowerCase() === "host" ? "cocalc.ai" : undefined,
      path: "/pricing",
      protocol: "https",
      query: {},
      url: "/pricing",
    } as any);

    expect(body.match(/<title>/g)).toHaveLength(1);
    expect(body).not.toContain("cocalc-head-begin");
    expect(body).not.toContain("cocalc-head-end");
  });

  it("does not interpret replacement patterns from request-derived values", async () => {
    const body = await renderPublicShell({
      get: (name: string) =>
        name.toLowerCase() === "host" ? "cocalc.ai$'" : undefined,
      path: "/pricing",
      protocol: "https",
      query: {},
      url: "/pricing",
    } as any);

    // With String.replace $-substitution, $' would splice the document tail
    // into the head, duplicating the webapp container div.
    expect(body.match(/cocalc-webapp-container/g)).toHaveLength(1);
    expect(body.match(/<title>/g)).toHaveLength(1);
  });
});
