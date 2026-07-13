/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decodeTarCQuotedString,
  parseTarExtractedLine,
  parseTarVerboseLine,
} from "./tar-output";

describe("GNU tar C-quoted output", () => {
  it("decodes control characters, quotes, and backslashes", () => {
    expect(
      decodeTarCQuotedString(
        '"./line1\\nvi Bankers.c\\r\\t\\"quote\\"\\\\tail\\001" suffix',
      ),
    ).toEqual({
      value: './line1\nvi Bankers.c\r\t"quote"\\tail\x01',
      remainder: " suffix",
    });
  });

  it("reassembles UTF-8 bytes represented as octal escapes", () => {
    expect(decodeTarCQuotedString('"./caf\\303\\251.sage"').value).toBe(
      "./café.sage",
    );
  });

  it("parses regular, symlink, and hardlink verbose records", () => {
    expect(
      parseTarVerboseLine(
        '-rw-r--r-- user/user 12 2026-07-13 17:27 "./line1\\nvi Bankers.c"',
      ),
    ).toEqual({
      path: "./line1\nvi Bankers.c",
      size: 12,
      type: "file",
      mtime: "2026-07-13T17:27Z",
    });
    expect(
      parseTarVerboseLine(
        'lrwxrwxrwx user/user 0 2026-07-13 17:27 "./sym" -> "line1\\ntarget"',
      ),
    ).toMatchObject({ path: "./sym", type: "symlink" });
    expect(
      parseTarVerboseLine(
        'hrw-r--r-- user/user 0 2026-07-13 17:27 "./hard" link to "./plain"',
      ),
    ).toMatchObject({ path: "./hard", type: "other" });
  });

  it("parses C-quoted verbose extraction output", () => {
    expect(parseTarExtractedLine('"./carriage\\rname\\\\tail"')).toBe(
      "./carriage\rname\\tail",
    );
  });

  it("rejects malformed quoted paths", () => {
    expect(() => decodeTarCQuotedString('"./unterminated')).toThrow(
      "unterminated",
    );
    expect(() => decodeTarCQuotedString('"./bad\\q"')).toThrow(
      "unsupported escape",
    );
    expect(() => parseTarExtractedLine('"./ok" trailing')).toThrow(
      "unexpected output",
    );
  });

  it("round-trips control-character filenames through a NUL member list", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cocalc-tar-output-"));
    try {
      const source = join(tmp, "source");
      const dest = join(tmp, "dest");
      const archive = join(tmp, "archive.tar");
      const memberList = join(tmp, "members.nul");
      mkdirSync(source);
      mkdirSync(dest);
      const files = new Map([
        ["ordinary file.sage", "ordinary"],
        ["line1\nvi Bankers.c", "newline"],
        ["carriage\rname\\tail.sobj", "carriage-return"],
        ['quote"and\ttab', "quoted-tab"],
      ]);
      for (const [name, contents] of files) {
        writeFileSync(join(source, name), contents);
      }

      const create = spawnSync("tar", ["-cf", archive, "-C", source, "."], {
        encoding: "utf8",
      });
      expect(create.status).toBe(0);
      const listing = spawnSync("tar", ["--quoting-style=c", "-tvf", archive], {
        encoding: "utf8",
      });
      expect(listing.status).toBe(0);
      const paths = listing.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => parseTarVerboseLine(line)?.path)
        .filter((value): value is string => value != null && value !== "./");
      expect(paths).toHaveLength(files.size);
      expect(new Set(paths)).toEqual(
        new Set(Array.from(files.keys(), (name) => `./${name}`)),
      );

      writeFileSync(
        memberList,
        Buffer.concat(
          paths.flatMap((name) => [Buffer.from(name), Buffer.from([0])]),
        ),
      );
      const extract = spawnSync(
        "tar",
        [
          "--quoting-style=c",
          "-xvf",
          archive,
          "-C",
          dest,
          "--null",
          "--verbatim-files-from",
          "--no-recursion",
          "-T",
          memberList,
        ],
        { encoding: "utf8" },
      );
      expect(extract.status).toBe(0);
      expect(
        extract.stdout.split("\n").filter(Boolean).map(parseTarExtractedLine),
      ).toEqual(paths);
      expect(readdirSync(dest).sort()).toEqual([...files.keys()].sort());
      for (const [name, contents] of files) {
        expect(readFileSync(join(dest, name), "utf8")).toBe(contents);
      }
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });
});
