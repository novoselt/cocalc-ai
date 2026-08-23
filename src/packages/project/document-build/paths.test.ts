/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { documentProcessPath, normalizeDocumentPath } from "./paths";

const env = {
  COCALC_RUNTIME_HOME: "/home/user",
  HOME: "/projects/example",
};

describe("document build paths", () => {
  it("normalizes relative and legacy runtime paths", () => {
    expect(normalizeDocumentPath("papers/a.tex", env)).toBe(
      "/home/user/papers/a.tex",
    );
    expect(normalizeDocumentPath("/root/papers/a.tex", env)).toBe(
      "/home/user/papers/a.tex",
    );
  });

  it("maps project-visible paths to the process home", () => {
    expect(documentProcessPath("/home/user/papers/a.tex", env)).toBe(
      "/projects/example/papers/a.tex",
    );
  });

  it("rejects paths outside the project home", () => {
    expect(() => normalizeDocumentPath("../../etc/passwd", env)).toThrow(
      "inside /home/user",
    );
    expect(() => normalizeDocumentPath("/etc/passwd", env)).toThrow(
      "inside /home/user",
    );
  });
});
