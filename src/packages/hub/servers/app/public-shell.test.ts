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
});
