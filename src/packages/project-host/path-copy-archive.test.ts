/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  archivePathIsAllowed,
  decodePathCopyArchiveListing,
} from "./path-copy-archive";

describe("path copy archive listings", () => {
  it("decodes GNU tar C-quoted UTF-8 paths before validation", () => {
    const entries = decodePathCopyArchiveListing(
      Buffer.from(
        '"Introduction \\303\\240 l\'informatique.ipynb"\n' +
          '"Introduction \\303\\240 l\'informatique.ipynb/data.json"\n',
      ),
    );

    expect(entries).toEqual([
      "Introduction à l'informatique.ipynb",
      "Introduction à l'informatique.ipynb/data.json",
    ]);
    const allowedRoots = new Set(["Introduction à l'informatique.ipynb"]);
    expect(
      entries.every((entry) => archivePathIsAllowed({ entry, allowedRoots })),
    ).toBe(true);
  });

  it("continues to reject paths outside the selected roots", () => {
    const allowedRoots = new Set(["assignment"]);
    for (const entry of [
      "../outside",
      "/absolute",
      "assignment/../../outside",
      "assignment\\..\\outside",
      "other/file",
    ]) {
      expect(archivePathIsAllowed({ entry, allowedRoots })).toBe(false);
    }
  });

  it("rejects unexpected text after a quoted archive path", () => {
    expect(() =>
      decodePathCopyArchiveListing(Buffer.from('"assignment/file" trailing\n')),
    ).toThrow("unexpected output");
  });
});
