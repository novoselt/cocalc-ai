import type { AddressInfo } from "node:net";
import express from "express";
import { get_server_settings } from "@cocalc/database/postgres/settings/server-settings";
import { APP_ROUTES } from "@cocalc/util/routing/app";
import initRobots from "./robots";

jest.mock("@cocalc/database/postgres/settings/server-settings", () => ({
  get_server_settings: jest.fn(),
}));

const mockGetServerSettings = get_server_settings as jest.Mock;

describe("robots.txt", () => {
  async function request({ host }: { host?: string } = {}) {
    const app = express();
    app.use("/robots.txt", initRobots());
    const server = await new Promise<ReturnType<typeof app.listen>>(
      (resolve) => {
        const next = app.listen(0, "127.0.0.1", () => resolve(next));
      },
    );
    try {
      const { port } = server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${port}`;
      const response = await fetch(`${origin}/robots.txt`, {
        headers: host == null ? undefined : { host },
      });
      return { body: await response.text(), origin, response };
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }

  it("adds the sitemap reference when landing pages are enabled", async () => {
    mockGetServerSettings.mockResolvedValueOnce({ landing_pages: true });

    const { body, origin, response } = await request();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body.split("\n")).toContain("Allow: /");
    expect(body.split("\n")).toContain("Allow: /share");
    expect(body.split("\n")).toContain("Allow: /static/");
    expect(body).not.toContain("Disallow: /static/");
    expect(body).toContain("Disallow: /webapp/");
    expect(body).toContain("Disallow: /cdn/");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(body).not.toMatch(/^ +/m);
  });

  it("allows the public cocalc.ai site even when the legacy landing pages setting is disabled", async () => {
    mockGetServerSettings.mockResolvedValueOnce({
      dns: "cocalc.ai",
      landing_pages: false,
    });

    const { body, origin, response } = await request({ host: "cocalc.ai" });

    expect(response.status).toBe(200);
    expect(body.split("\n")).toContain("Allow: /");
    expect(body.split("\n")).toContain("Allow: /share/");
    expect(body.split("\n")).toContain("Allow: /static/");
    expect(body).not.toContain("Disallow: /static/");
    expect(body).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(body).not.toContain("Disallow: /\n");
  });

  it("blocks app shell routes except public shares", async () => {
    mockGetServerSettings.mockResolvedValueOnce({
      dns: "cocalc.ai",
      landing_pages: false,
    });

    const { body } = await request({ host: "cocalc.ai" });
    const lines = body.split("\n");

    for (const route of APP_ROUTES) {
      if (route === "share") {
        expect(lines).not.toContain(`Disallow: /${route}`);
      } else {
        expect(lines).toContain(`Disallow: /${route}`);
      }
    }
  });

  it("keeps the locked-down default when landing pages are disabled", async () => {
    mockGetServerSettings.mockResolvedValueOnce({
      dns: "localhost:9100",
      landing_pages: false,
    });

    const { body, response } = await request();

    expect(response.status).toBe(200);
    expect(body).toBe("User-agent: *\nAllow: /share\nDisallow: /\n");
    expect(body).not.toContain("Sitemap:");
    expect(body).not.toMatch(/^ +/m);
  });
});
