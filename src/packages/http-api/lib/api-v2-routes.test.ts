/** @jest-environment node */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  discoverApiV2Routes,
  EMBEDDED_API_V2_ROUTES_LOADER,
  loadEmbeddedApiV2Routes,
} from "./api-v2-routes";

type EmbeddedApiV2RoutesGlobal = {
  [key: symbol]: unknown;
};

const embeddedRoutesGlobal = globalThis as unknown as EmbeddedApiV2RoutesGlobal;
const embeddedRoutesSymbol = Symbol.for(EMBEDDED_API_V2_ROUTES_LOADER);

describe("discoverApiV2Routes", () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };

  afterEach(() => {
    jest.clearAllMocks();
    delete embeddedRoutesGlobal[embeddedRoutesSymbol];
  });

  it("discovers handlers directly from the api/v2 filesystem layout", () => {
    const root = mkdtempSync(join(tmpdir(), "http-api-routes-"));
    try {
      mkdirSync(join(root, "auth"), { recursive: true });
      writeFileSync(
        join(root, "index.js"),
        "module.exports = function docs(_req, res) { res.end('docs'); };\n",
      );
      writeFileSync(
        join(root, "auth", "sign-in.js"),
        "module.exports = function signIn(_req, res) { res.end('sign-in'); };\n",
      );
      writeFileSync(
        join(root, "auth", "ignored.test.js"),
        "module.exports = function ignored() {};\n",
      );

      const withoutDocs = discoverApiV2Routes({
        rootDir: root,
        includeDocs: false,
        ensureLibAlias: false,
        logger: logger as any,
      });
      expect(withoutDocs.map(({ path }) => path)).toEqual(["/auth/sign-in"]);

      const withDocs = discoverApiV2Routes({
        rootDir: root,
        includeDocs: true,
        ensureLibAlias: false,
        logger: logger as any,
      });
      expect(withDocs.map(({ path }) => path)).toEqual(["/auth/sign-in", "/"]);
      expect(
        withDocs.every(({ handler }) => typeof handler === "function"),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads and validates routes registered by a release bundle", () => {
    const handler = jest.fn();
    const loader = jest.fn(() => [{ path: "/health", handler }]);
    embeddedRoutesGlobal[embeddedRoutesSymbol] = loader;

    expect(loadEmbeddedApiV2Routes()).toEqual([{ path: "/health", handler }]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid embedded route loaders", () => {
    embeddedRoutesGlobal[embeddedRoutesSymbol] = () => [
      { path: "/health", handler: "not-a-function" },
    ];

    expect(() => loadEmbeddedApiV2Routes()).toThrow(
      "embedded api v2 route loader contains an invalid route entry",
    );
  });
});
