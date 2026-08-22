import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { setApplicationShellCacheHeaders } from "./application-shell-cache";

describe("static application shell routes", () => {
  it("serves app.html with a private short-lived browser cache", async () => {
    const staticPath = mkdtempSync(join(tmpdir(), "cocalc-static-shell-"));
    writeFileSync(join(staticPath, "app.html"), "<!doctype html><p>app</p>");

    const app = express();
    app.use(
      "/static/app.html",
      express.static(join(staticPath, "app.html"), {
        setHeaders: setApplicationShellCacheHeaders,
      }),
    );
    const server = await new Promise<ReturnType<typeof app.listen>>(
      (resolve) => {
        const next = app.listen(0, "127.0.0.1", () => resolve(next));
      },
    );

    try {
      const before = Date.now();
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/static/app.html`);
      const expires = Date.parse(response.headers.get("expires") ?? "");

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "private, max-age=10, must-revalidate",
      );
      expect(expires).toBeGreaterThanOrEqual(before + 8_000);
      expect(expires).toBeLessThanOrEqual(Date.now() + 11_000);
      expect(await response.text()).toContain("<p>app</p>");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      rmSync(staticPath, { recursive: true, force: true });
    }
  });
});
