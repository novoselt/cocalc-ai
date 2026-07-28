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

  it("rewrites the public alias once and targets the canonical server origin", async () => {
    const priorPath = process.env.COCALC_CONAT_PATH_COMPONENT;
    process.env.COCALC_CONAT_PATH_COMPONENT = "workspace-conat";
    try {
      const { proxyConatRequest } = await import("./proxy-conat");
      const req: any = {
        originalUrl: "/workspace-conat/?EIO=4&transport=polling",
        url: "/workspace-conat/?EIO=4&transport=polling",
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
    } finally {
      if (priorPath == null) {
        delete process.env.COCALC_CONAT_PATH_COMPONENT;
      } else {
        process.env.COCALC_CONAT_PATH_COMPONENT = priorPath;
      }
    }
  });
});
