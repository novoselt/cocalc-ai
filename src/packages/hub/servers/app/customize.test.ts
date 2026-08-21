import type { AddressInfo } from "node:net";
import express from "express";
import initCustomize from "./customize";

const getWebappConfiguration = jest.fn(async () => ({
  configuration: {},
}));

jest.mock("@cocalc/hub/webapp-configuration", () => ({
  WebappConfiguration: jest.fn().mockImplementation(() => ({
    get: getWebappConfiguration,
  })),
}));

jest.mock("@cocalc/server/auth/get-account", () => ({
  __esModule: true,
  default: jest.fn(async () => "account-id"),
}));

jest.mock("@cocalc/server/accounts/is-in-group", () => ({
  __esModule: true,
  default: jest.fn(async () => true),
}));

jest.mock("../database", () => ({
  getDatabase: jest.fn(() => ({})),
}));

jest.mock("@cocalc/hub/manifest", () => ({
  send: jest.fn(),
}));

describe("customize route", () => {
  it("keeps account-specific configuration out of shared caches", async () => {
    const app = express();
    const router = express.Router();
    initCustomize(router, false);
    app.use(router);
    const server = await new Promise<ReturnType<typeof app.listen>>(
      (resolve) => {
        const next = app.listen(0, "127.0.0.1", () => resolve(next));
      },
    );

    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/customize`);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-cache");
      expect(await response.json()).toMatchObject({
        configuration: {
          is_admin: true,
          is_authenticated: true,
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
