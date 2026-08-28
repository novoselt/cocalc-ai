/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readStarServerInfo } from "./star-server-info";

describe("Star server release metadata", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cocalc-star-info-"));
    await mkdir(join(root, "releases", "release-1", "source"), {
      recursive: true,
    });
    await symlink(join("releases", "release-1"), join(root, "current"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads the canonical installed release identity", async () => {
    await writeFile(
      join(root, "channel.env"),
      [
        "COCALC_STAR_CHANNEL=stable",
        "COCALC_STAR_GIT_REVISION=0123456789abcdef0123456789abcdef01234567",
        "COCALC_STAR_PROMOTED_AT=2026-08-28T00:00:00.000Z",
        "IGNORED_VALUE=not-release-metadata",
      ].join("\n"),
    );
    await writeFile(
      join(root, "current", "release.json"),
      JSON.stringify({
        release_id: "star-release-1",
        installed_at: "2026-08-28T01:00:00.000Z",
        tarball_sha256: "installed-sha",
      }),
    );
    await writeFile(
      join(root, "current", "source", "release.json"),
      JSON.stringify({ product: "cocalc-star", git_dirty: false }),
    );
    await writeFile(
      join(root, "current", "build-release.json"),
      JSON.stringify({
        built_at: "2026-08-27T23:00:00.000Z",
        payload_kind: "runtime",
      }),
    );

    await expect(readStarServerInfo(root)).resolves.toMatchObject({
      detected: true,
      product: "cocalc-star",
      channel: "stable",
      release_id: "star-release-1",
      promoted_at: "2026-08-28T00:00:00.000Z",
      git_revision: "0123456789abcdef0123456789abcdef01234567",
      git_dirty: false,
      payload_kind: "runtime",
      built_at: "2026-08-27T23:00:00.000Z",
      installed_at: "2026-08-28T01:00:00.000Z",
      tarball_sha256: "installed-sha",
      install_root: root,
      current_release_path: "releases/release-1",
    });
  });
});
