/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

let queryMock: jest.Mock;

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query: queryMock }),
}));

jest.mock("@cocalc/backend/logger", () => ({
  __esModule: true,
  default: () => ({
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
  }),
  getLogger: () => ({
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
  }),
}));

jest.mock("@cocalc/server/rootfs/events", () => ({
  appendRootfsImageEventForReleaseImages: jest.fn(),
}));

jest.mock("@cocalc/server/rootfs/rustic-repo-schema", () => ({
  ensureRootfsRusticRepoSchema: jest.fn(async () => undefined),
}));

const RELEASE_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

const release = {
  release_id: RELEASE_ID,
  content_key: "content-key",
  runtime_image: "cocalc.local/rootfs/content-key",
  source_image: null,
  parent_release_id: null,
  depth: 0,
  arch: "amd64",
  size_bytes: 1000,
  artifact_kind: "full",
  artifact_format: "rustic",
  artifact_backend: "r2",
  artifact_path: "rustic:snapshot",
  repo_id: null,
  artifact_sha256: "content-key",
  artifact_bytes: 500,
  inspect_json: null,
};

function countForQuery(sql: string, catalogReferences: number): number {
  if (sql.includes("prepull=true")) return 0;
  if (sql.includes("FROM rootfs_images")) return catalogReferences;
  return 0;
}

describe("requestUnreferencedRootfsReleaseDeletion", () => {
  it("queues an unreferenced release for garbage collection", async () => {
    queryMock = jest.fn(async (sql: string) => {
      if (
        sql.includes("artifact_sha256") &&
        sql.includes("WHERE release_id=$1")
      ) {
        return { rows: [release] };
      }
      if (sql.includes("UPDATE rootfs_releases AS rel")) {
        return { rows: [{ release_id: RELEASE_ID }] };
      }
      if (sql.includes("COUNT(")) {
        return { rows: [{ count: "0" }] };
      }
      return { rows: [] };
    });
    const { requestUnreferencedRootfsReleaseDeletion } =
      await import("./releases");

    const result = await requestUnreferencedRootfsReleaseDeletion({
      release_id: RELEASE_ID,
      requested_by: ACCOUNT_ID,
      reason: "publish failed",
    });

    expect(result.queued).toBe(true);
    expect(result.blockers.total).toBe(0);
  });

  it("does not queue a release referenced by a live catalog image", async () => {
    queryMock = jest.fn(async (sql: string) => {
      if (
        sql.includes("artifact_sha256") &&
        sql.includes("WHERE release_id=$1")
      ) {
        return { rows: [release] };
      }
      if (sql.includes("UPDATE rootfs_releases AS rel")) {
        return { rows: [] };
      }
      if (sql.includes("COUNT(")) {
        return {
          rows: [{ count: `${countForQuery(sql, 1)}` }],
        };
      }
      return { rows: [] };
    });
    const { requestUnreferencedRootfsReleaseDeletion } =
      await import("./releases");

    const result = await requestUnreferencedRootfsReleaseDeletion({
      release_id: RELEASE_ID,
      requested_by: ACCOUNT_ID,
      reason: "publish failed",
    });

    expect(result.queued).toBe(false);
    expect(result.blockers.catalog_entries_using_release).toBe(1);
    expect(result.blockers.total).toBe(1);
  });
});

export {};
