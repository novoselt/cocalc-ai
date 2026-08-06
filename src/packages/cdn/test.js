const { existsSync } = require("node:fs");
const { join } = require("node:path");

describe("built CDN assets", () => {
  const obj = require(".");
  const { path } = require("./path");

  it("has a path that contains cdn", () => {
    expect(path).toContain("/cdn/");
  });

  it("exports the version of every packaged dependency", () => {
    for (const name of ["codemirror", "katex", "pdfjs-dist"]) {
      expect(obj.versions[name]).toEqual(expect.any(String));
      expect(obj.versions[name]).not.toHaveLength(0);
    }
  });

  it("contains packed PDF.js CMaps at unversioned and versioned paths", () => {
    const cmap = "Adobe-Japan1-UCS2.bcmap";
    expect(existsSync(join(path, "pdfjs-dist", "cmaps", cmap))).toBe(true);
    expect(
      existsSync(
        join(path, `pdfjs-dist-${obj.versions["pdfjs-dist"]}`, "cmaps", cmap),
      ),
    ).toBe(true);
  });

  it("does not copy the rest of the PDF.js distribution", () => {
    expect(existsSync(join(path, "pdfjs-dist", "build"))).toBe(false);
  });
});
