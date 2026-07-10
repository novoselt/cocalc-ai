import type { AddressInfo } from "node:net";
import express from "express";
import initPublicContent from "./public-content";

jest.mock("@cocalc/database/postgres/news", () => ({
  getFeedData: jest.fn(async () => []),
}));

jest.mock("@cocalc/database/settings/customize", () => ({
  __esModule: true,
  default: jest.fn(async () => ({ siteName: "CoCalc" })),
}));

describe("public content routes", () => {
  async function request(path: string) {
    const app = express();
    const router = express.Router();
    initPublicContent(router);
    app.use(router);
    const server = await new Promise<ReturnType<typeof app.listen>>(
      (resolve) => {
        const next = app.listen(0, "127.0.0.1", () => resolve(next));
      },
    );
    try {
      const { port } = server.address() as AddressInfo;
      return await fetch(`http://127.0.0.1:${port}${path}`, {
        redirect: "manual",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }

  it("serves the guides bridge page from the clean URL", async () => {
    const response = await request("/guides?topic=jupyter");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(body).toContain("<title>CoCalc Guides | CoCalc</title>");
    expect(body).toContain('rel="canonical"');
    expect(body).toContain('href="http://127.0.0.1');
    expect(body).toContain('/guides" rel="canonical"');
  });
});
