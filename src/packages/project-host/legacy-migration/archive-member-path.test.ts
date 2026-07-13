/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertSafeArchiveMemberPath,
  unsafeArchiveMemberPathReason,
} from "./archive-member-path";
import { parseTarVerboseLine } from "./tar-output";

describe("legacy archive member path safety", () => {
  it("treats Windows-style backslashes as literal Linux filename bytes", () => {
    const archivePath = "./PastPapers/Censor/Code/..\\Figures\\toycvg200.pdf";
    expect(unsafeArchiveMemberPathReason(archivePath)).toBeUndefined();
    expect(() => assertSafeArchiveMemberPath(archivePath)).not.toThrow();
  });

  it.each([
    ["../outside", "parent-directory"],
    ["./inside/../outside", "parent-directory"],
    ["/absolute/path", "absolute"],
    ["./nul\0path", "NUL"],
  ])("rejects unsafe POSIX archive path %p", (archivePath, reason) => {
    expect(unsafeArchiveMemberPathReason(archivePath)).toContain(reason);
    expect(() => assertSafeArchiveMemberPath(archivePath)).toThrow(reason);
  });

  it("classifies real tar members without confusing backslashes for separators", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cocalc-archive-safety-"));
    try {
      const source = join(tmp, "source");
      const code = join(source, "PastPapers", "Censor", "Code");
      const archive = join(tmp, "archive.tar");
      mkdirSync(code, { recursive: true });
      writeFileSync(join(code, "..\\Figures\\toycvg200.pdf"), "recover me");
      writeFileSync(join(source, "unsafe-source"), "do not extract");
      expect(
        spawnSync("tar", ["-cf", archive, "-C", source, "PastPapers"]).status,
      ).toBe(0);
      expect(
        spawnSync("tar", [
          "-rf",
          archive,
          "-C",
          source,
          "--transform=s|^unsafe-source$|../outside|",
          "unsafe-source",
        ]).status,
      ).toBe(0);

      const listing = spawnSync("tar", ["--quoting-style=c", "-tvf", archive], {
        encoding: "utf8",
      });
      expect(listing.status).toBe(0);
      const paths = listing.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => parseTarVerboseLine(line)?.path)
        .filter((value): value is string => value != null);
      expect(paths).toContain(
        "PastPapers/Censor/Code/..\\Figures\\toycvg200.pdf",
      );
      expect(paths.filter(unsafeArchiveMemberPathReason)).toEqual([
        "../outside",
      ]);
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });
});
