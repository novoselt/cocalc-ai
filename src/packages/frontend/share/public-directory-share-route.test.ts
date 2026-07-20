import {
  classifySharePath,
  shareRouteCandidates,
} from "./public-directory-share-route";

describe("shareRouteCandidates", () => {
  it("treats a single segment as a share path first", () => {
    expect(shareRouteCandidates("test2")).toEqual([
      { slug: "test2", relativePath: "" },
    ]);
  });

  it("tries longest share path first and then peels file path segments", () => {
    expect(shareRouteCandidates("agent-test/route-1/a.ipynb")).toEqual([
      { slug: "agent-test/route-1/a.ipynb", relativePath: "" },
      { slug: "agent-test/route-1", relativePath: "a.ipynb" },
      { slug: "agent-test", relativePath: "route-1/a.ipynb" },
    ]);
  });

  it("normalizes repeated and leading slashes", () => {
    expect(shareRouteCandidates("/test2//dir/a.py")).toEqual([
      { slug: "test2/dir/a.py", relativePath: "" },
      { slug: "test2/dir", relativePath: "a.py" },
      { slug: "test2", relativePath: "dir/a.py" },
    ]);
  });

  it("keeps trying shorter slugs for direct file URLs with dotted names", () => {
    expect(shareRouteCandidates("course/unit.1/notes/a.md")).toEqual([
      { slug: "course/unit.1/notes/a.md", relativePath: "" },
      { slug: "course/unit.1/notes", relativePath: "a.md" },
      { slug: "course/unit.1", relativePath: "notes/a.md" },
      { slug: "course", relativePath: "unit.1/notes/a.md" },
    ]);
  });

  it("treats Cambridge /files/ as a legacy separator before the file path", () => {
    expect(
      shareRouteCandidates(
        "Cambridge/S0022112023006092/JFM-Notebooks/files/Figure-13/D-vortices-plot.ipynb",
      ),
    ).toEqual([
      {
        slug: "Cambridge/S0022112023006092/JFM-Notebooks/files/Figure-13/D-vortices-plot.ipynb",
        relativePath: "",
      },
      {
        slug: "Cambridge/S0022112023006092/JFM-Notebooks/files/Figure-13",
        relativePath: "D-vortices-plot.ipynb",
      },
      {
        slug: "Cambridge/S0022112023006092/JFM-Notebooks/files",
        relativePath: "Figure-13/D-vortices-plot.ipynb",
      },
      {
        slug: "Cambridge/S0022112023006092/JFM-Notebooks",
        relativePath: "Figure-13/D-vortices-plot.ipynb",
      },
      {
        slug: "Cambridge/S0022112023006092/JFM-Notebooks",
        relativePath: "files/Figure-13/D-vortices-plot.ipynb",
      },
      {
        slug: "Cambridge/S0022112023006092",
        relativePath: "JFM-Notebooks/files/Figure-13/D-vortices-plot.ipynb",
      },
      {
        slug: "Cambridge",
        relativePath:
          "S0022112023006092/JFM-Notebooks/files/Figure-13/D-vortices-plot.ipynb",
      },
    ]);
  });

  it("treats Cambridge /files as a legacy root-share URL", () => {
    expect(shareRouteCandidates("Cambridge/article/files")).toEqual([
      { slug: "Cambridge/article/files", relativePath: "" },
      { slug: "Cambridge/article", relativePath: "" },
      { slug: "Cambridge/article", relativePath: "files" },
      { slug: "Cambridge", relativePath: "article/files" },
    ]);
  });

  it("does not apply the legacy /files/ separator outside Cambridge", () => {
    expect(shareRouteCandidates("test2/files/a.py")).toEqual([
      { slug: "test2/files/a.py", relativePath: "" },
      { slug: "test2/files", relativePath: "a.py" },
      { slug: "test2", relativePath: "files/a.py" },
    ]);
  });
});

describe("classifySharePath", () => {
  it("does not probe the root of a resolved share", async () => {
    const listDirectory = jest.fn();

    await expect(
      classifySharePath({ relativePath: "", listDirectory }),
    ).resolves.toBe("directory");
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("retries transient failures before identifying a directory", async () => {
    const transientError = new Error("project connection closed");
    const listDirectory = jest
      .fn()
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ files: [] });
    const wait = jest.fn().mockResolvedValue(undefined);

    await expect(
      classifySharePath({
        relativePath: "Fall2025",
        listDirectory,
        retryDelaysMs: [100, 300],
        wait,
      }),
    ).resolves.toBe("directory");
    expect(listDirectory).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[100], [300]]);
  });

  it("identifies a file only from a definitive not-directory error", async () => {
    const listDirectory = jest.fn().mockRejectedValue({
      error: {
        code: "ENOTDIR",
        message: "not a directory",
      },
    });
    const wait = jest.fn();

    await expect(
      classifySharePath({
        relativePath: "DPAC.md",
        listDirectory,
        retryDelaysMs: [100],
        wait,
      }),
    ).resolves.toBe("file");
    expect(listDirectory).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("surfaces persistent probe failures instead of treating them as files", async () => {
    const error = new Error("no responders for project filesystem");
    const listDirectory = jest.fn().mockRejectedValue(error);

    await expect(
      classifySharePath({
        relativePath: "Fall2025",
        listDirectory,
        retryDelaysMs: [100, 300],
        wait: async () => {},
      }),
    ).rejects.toBe(error);
    expect(listDirectory).toHaveBeenCalledTimes(3);
  });
});
