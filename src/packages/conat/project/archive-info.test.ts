describe("project archive-info explicit routing", () => {
  it("requires an explicit Conat client for archive reads", async () => {
    const {
      getBackups,
      getBackupFiles,
      getBackupFileText,
      getSnapshotFileText,
    } = await import("./archive-info");
    const project_id = "00000000-1000-4000-8000-000000000000";

    await expect(getBackups({ project_id })).rejects.toThrow(
      "must provide an explicit Conat client",
    );
    await expect(
      getBackupFiles({
        project_id,
        id: "backup-1",
      }),
    ).rejects.toThrow("must provide an explicit Conat client");
    await expect(
      getBackupFileText({
        project_id,
        id: "backup-1",
        path: "file.txt",
      }),
    ).rejects.toThrow("must provide an explicit Conat client");
    await expect(
      getSnapshotFileText({
        project_id,
        snapshot: "snapshot-1",
        path: "file.txt",
      }),
    ).rejects.toThrow("must provide an explicit Conat client");
  });

  it("normalizes legacy array responses for bounded search previews", async () => {
    const { findBackupFiles } = await import("./archive-info");
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: `backup-${index}`,
      time: new Date("2026-08-10T00:00:00Z"),
      path: `file-${index}.pdf`,
      isDir: false,
      mtime: index,
      size: index,
    }));
    const find = jest.fn(async () => rows);
    const client = {
      call: jest.fn(() => ({ findBackupFiles: find })),
    } as any;

    await expect(
      findBackupFiles({
        client,
        project_id: "00000000-1000-4000-8000-000000000000",
        iglob: ["*pdf*"],
        preview: true,
        recursive: true,
      }),
    ).resolves.toMatchObject({
      results: expect.any(Array),
      truncated: true,
      truncationReason: "results",
    });
    const response = await findBackupFiles({
      client,
      project_id: "00000000-1000-4000-8000-000000000000",
      iglob: ["*pdf*"],
      preview: true,
      recursive: true,
    });
    expect(response.results).toHaveLength(100);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ preview: true, recursive: true }),
    );
  });
});
