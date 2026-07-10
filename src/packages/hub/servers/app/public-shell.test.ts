import { renderPublicShell } from "./public-shell";

jest.mock("@cocalc/database/settings/customize", () => ({
  __esModule: true,
  default: jest.fn(async () => ({ siteName: "CoCalc" })),
}));

function request(path: string, query: Record<string, string> = {}) {
  const search = new URLSearchParams(query).toString();
  return {
    get: (name: string) =>
      name.toLowerCase() === "host" ? "cocalc.ai" : undefined,
    path,
    protocol: "https",
    query,
    url: search ? `${path}?${search}` : path,
  } as any;
}

describe("public shell rendering", () => {
  it("canonicalizes static shell target URLs to the clean public URL", async () => {
    const { html: body, status } = await renderPublicShell(
      request("/static/public.html", {
        target: "/features/jupyter-notebook?x=1",
      }),
    );

    expect(status).toBe(200);
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
    const { html: body, status } = await renderPublicShell(request("/pricing"));

    expect(status).toBe(200);
    expect(body.match(/<title>/g)).toHaveLength(1);
    expect(body).not.toContain("cocalc-head-begin");
    expect(body).not.toContain("cocalc-head-end");
  });

  it("does not interpret replacement patterns from request-derived values", async () => {
    const { html: body } = await renderPublicShell({
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

  it("gives news posts a per-post canonical and title", async () => {
    const { html: body, status } = await renderPublicShell(
      request("/news/cocalc-launches-something-42"),
    );

    expect(status).toBe(200);
    expect(body).toContain(
      'href="https://cocalc.ai/news/cocalc-launches-something-42" rel="canonical"',
    );
    expect(body).toContain("<title>Cocalc launches something | CoCalc</title>");
  });

  it("canonicalizes news history views to the current post", async () => {
    const { html: body } = await renderPublicShell(
      request("/news/cocalc-launches-something-42/1751000000"),
    );

    expect(body).toContain(
      'href="https://cocalc.ai/news/cocalc-launches-something-42" rel="canonical"',
    );
  });

  it("gives rootfs detail pages per-image canonicals", async () => {
    const bySlug = await renderPublicShell(request("/rootfs/ubuntu-24.04"));
    expect(bySlug.status).toBe(200);
    expect(bySlug.html).toContain(
      'href="https://cocalc.ai/rootfs/ubuntu-24.04" rel="canonical"',
    );

    const byId = await renderPublicShell(request("/rootfs/id/abc123"));
    expect(byId.html).toContain(
      'href="https://cocalc.ai/rootfs/id/abc123" rel="canonical"',
    );
  });

  it("responds 404 for detail slugs that are not in a registry", async () => {
    for (const path of [
      "/docs/does-not-exist",
      "/about/team/not-a-person",
      "/policies/bogus",
      "/features/no-such-feature",
    ]) {
      const { status } = await renderPublicShell(request(path));
      expect({ path, status }).toEqual({ path, status: 404 });
    }
  });

  it("responds 200 for known detail slugs", async () => {
    for (const path of [
      "/docs/collaboration/chat",
      "/about/team/harald-schilly",
      "/policies/privacy",
      "/features/jupyter-notebook",
      "/features/compare",
    ]) {
      const { status } = await renderPublicShell(request(path));
      expect({ path, status }).toEqual({ path, status: 200 });
    }
  });
});
