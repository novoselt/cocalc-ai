import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import express from "express";
import { APP_ROUTES } from "@cocalc/util/routing/app";
import initRobots from "./robots";

jest.mock("@cocalc/database/postgres/news", () => ({
  getFeedData: jest.fn(async () => []),
}));

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
      return await new Promise<{
        body: string;
        contentType?: string;
        status: number;
      }>((resolve, reject) => {
        const request = httpRequest(
          {
            headers: host == null ? undefined : { Host: host },
            hostname: "127.0.0.1",
            path: "/robots.txt",
            port,
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            response.on("end", () =>
              resolve({
                body: Buffer.concat(chunks).toString("utf8"),
                contentType: response.headers["content-type"],
                status: response.statusCode ?? 0,
              }),
            );
          },
        );
        request.on("error", reject);
        request.end();
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }

  it("allows indexing only on the canonical public host", async () => {
    const { body, contentType, status } = await request({ host: "cocalc.ai" });

    expect(status).toBe(200);
    expect(contentType).toContain("text/plain");
    expect(body.split("\n")).toContain("Allow: /");
    expect(body.split("\n")).toContain("Allow: /share");
    expect(body.split("\n")).toContain("Allow: /static/");
    expect(body).toContain("Disallow: /static/public.html");
    expect(body).toContain("Disallow: /static/app.html");
    expect(body).toContain("Disallow: /static/embed.html");
    expect(body).toContain("Disallow: /static/public-viewer");
    expect(body).not.toContain("Disallow: /static/\n");
    expect(body).toContain("Disallow: /webapp/");
    expect(body).toContain("Disallow: /cdn/");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("Sitemap: http://cocalc.ai/sitemap.xml");
    expect(body).not.toMatch(/^ +/m);
  });

  it("blocks app shell routes except public shares", async () => {
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

  it("keeps dev, local, and branded instances locked down", async () => {
    for (const host of [
      "localhost:9100",
      "dev123.cocalc.ai",
      "university.example.edu",
    ]) {
      const { body, status } = await request({ host });
      expect({ body, host, status }).toEqual({
        body: "User-agent: *\nAllow: /share\nDisallow: /\n",
        host,
        status: 200,
      });
      expect(body).not.toContain("Sitemap:");
      expect(body).not.toMatch(/^ +/m);
    }
  });
});
