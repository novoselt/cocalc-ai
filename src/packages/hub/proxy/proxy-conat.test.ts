/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const mockProxyWeb = jest.fn();
const mockCreateProxyServer = jest.fn(() => ({
  on: jest.fn(),
  web: mockProxyWeb,
  ws: jest.fn(),
}));

jest.mock("http-proxy-3", () => ({
  createProxyServer: (...args) => mockCreateProxyServer(...args),
}));

jest.mock("@cocalc/backend/logger", () => ({
  __esModule: true,
  default: () => ({
    debug: jest.fn(),
  }),
}));

jest.mock("@cocalc/backend/data", () => ({
  conatServer: "http://upstream.invalid",
  conatClusterPort: 9002,
}));

jest.mock("@cocalc/backend/base-path", () => ({
  __esModule: true,
  default: "/",
}));

jest.mock("@cocalc/backend/conat", () => ({
  conat: () => ({
    waitUntilSignedIn: jest.fn().mockResolvedValue(undefined),
    info: {},
  }),
}));

describe("Conat proxy", () => {
  beforeEach(() => {
    mockProxyWeb.mockReset();
    mockCreateProxyServer.mockClear();
  });

  it("targets the server origin without duplicating the request path", async () => {
    const { proxyConatRequest } = await import("./proxy-conat");
    const req: any = {
      originalUrl: "/conat/?EIO=4&transport=polling",
      url: "/conat/?EIO=4&transport=polling",
    };
    const res: any = {};

    await proxyConatRequest(req, res, { localConatServer: true });

    expect(req.url).toBe("/conat/?EIO=4&transport=polling");
    expect(mockCreateProxyServer).toHaveBeenCalledWith({
      ws: true,
      secure: false,
      target: "http://localhost:9002",
    });
    expect(mockProxyWeb).toHaveBeenCalledWith(req, res);
  });
});
