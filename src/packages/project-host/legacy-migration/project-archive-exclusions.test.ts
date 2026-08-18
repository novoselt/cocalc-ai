/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  projectArchiveRsyncExcludeArgs,
  projectArchiveTarExcludeArgs,
} from "./project-archive";

describe("legacy project archive extraction exclusions", () => {
  it("anchors managed paths at the project root", () => {
    expect(
      projectArchiveRsyncExcludeArgs([".snapshots", ".ssh/authorized_keys"]),
    ).toEqual(["--exclude=/.snapshots", "--exclude=/.ssh/authorized_keys"]);
    expect(
      projectArchiveTarExcludeArgs([".snapshots", ".ssh/authorized_keys"]),
    ).toEqual([
      "--exclude=.snapshots",
      "--exclude=./.snapshots",
      "--exclude=.ssh/authorized_keys",
      "--exclude=./.ssh/authorized_keys",
    ]);
  });

  it("rejects an extraction exclusion list that approaches ARG_MAX", () => {
    expect(() =>
      projectArchiveTarExcludeArgs([`oversized-${"x".repeat(70_000)}`]),
    ).toThrow("bytes of extraction exclusions");
  });

  it("extracts ordinary and nested lookalike paths but not managed roots", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cocalc-archive-exclusions-"));
    try {
      const source = join(tmp, "source");
      const dest = join(tmp, "dest");
      const archive = join(tmp, "archive.tar");
      mkdirSync(join(source, ".snapshots", "current"), { recursive: true });
      mkdirSync(join(source, ".ssh"), { recursive: true });
      mkdirSync(join(source, "nested", ".snapshots"), { recursive: true });
      mkdirSync(dest);
      writeFileSync(join(source, ".snapshots", "current", "state"), "old");
      writeFileSync(join(source, ".ssh", "authorized_keys"), "managed");
      writeFileSync(join(source, "nested", ".snapshots", "result"), "keep");
      writeFileSync(join(source, "ordinary.txt"), "ordinary");
      writeFileSync(join(source, "oversized.bin"), "skip");

      expect(spawnSync("tar", ["-cf", archive, "-C", source, "."]).status).toBe(
        0,
      );
      const extracted = spawnSync(
        "tar",
        [
          "--no-wildcards",
          "--anchored",
          ...projectArchiveTarExcludeArgs([
            ".snapshots",
            ".ssh/authorized_keys",
            "oversized.bin",
          ]),
          "-xf",
          archive,
          "-C",
          dest,
        ],
        { encoding: "utf8" },
      );
      expect(extracted.status).toBe(0);
      expect(extracted.stderr).toBe("");
      expect(existsSync(join(dest, ".snapshots"))).toBe(false);
      expect(existsSync(join(dest, ".ssh", "authorized_keys"))).toBe(false);
      expect(existsSync(join(dest, "oversized.bin"))).toBe(false);
      expect(
        readFileSync(join(dest, "nested", ".snapshots", "result"), "utf8"),
      ).toBe("keep");
      expect(readFileSync(join(dest, "ordinary.txt"), "utf8")).toBe("ordinary");
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });

  it("preserves managed destination roots during the final apply", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cocalc-archive-apply-"));
    try {
      const source = join(tmp, "source");
      const dest = join(tmp, "dest");
      mkdirSync(join(source, ".snapshots", "archive"), { recursive: true });
      mkdirSync(join(source, "nested", ".snapshots"), { recursive: true });
      mkdirSync(join(dest, ".snapshots", "current"), { recursive: true });
      writeFileSync(join(source, ".snapshots", "archive", "state"), "ignore");
      writeFileSync(join(source, "nested", ".snapshots", "result"), "keep");
      writeFileSync(join(source, "restored.txt"), "restored");
      writeFileSync(join(dest, ".snapshots", "current", "state"), "preserve");
      writeFileSync(join(dest, "stale.txt"), "delete");

      const applied = spawnSync(
        "rsync",
        [
          "-aHS",
          "--delete",
          ...projectArchiveRsyncExcludeArgs([".snapshots"]),
          `${source}/`,
          `${dest}/`,
        ],
        { encoding: "utf8" },
      );
      expect(applied.status).toBe(0);
      expect(applied.stderr).toBe("");
      expect(
        readFileSync(join(dest, ".snapshots", "current", "state"), "utf8"),
      ).toBe("preserve");
      expect(existsSync(join(dest, ".snapshots", "archive"))).toBe(false);
      expect(existsSync(join(dest, "stale.txt"))).toBe(false);
      expect(
        readFileSync(join(dest, "nested", ".snapshots", "result"), "utf8"),
      ).toBe("keep");
      expect(readFileSync(join(dest, "restored.txt"), "utf8")).toBe("restored");
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });
});
