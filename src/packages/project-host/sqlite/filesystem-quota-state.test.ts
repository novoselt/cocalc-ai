describe("project filesystem quota state", () => {
  const originalSqlite = process.env.COCALC_LITE_SQLITE_FILENAME;

  beforeEach(() => {
    jest.resetModules();
    process.env.COCALC_LITE_SQLITE_FILENAME = ":memory:";
  });

  afterAll(() => {
    if (originalSqlite == null) {
      delete process.env.COCALC_LITE_SQLITE_FILENAME;
    } else {
      process.env.COCALC_LITE_SQLITE_FILENAME = originalSqlite;
    }
  });

  it("preserves the epoch across ordinary process reconciliation", async () => {
    const state = await import("./filesystem-quota-state");
    const first = state.reconcileProjectFilesystemQuotaState({
      mountpoint: "/mnt/cocalc",
      filesystem_uuid: "filesystem-1",
      quota_mode: "simple",
    });
    const second = state.reconcileProjectFilesystemQuotaState({
      mountpoint: "/mnt/cocalc",
      filesystem_uuid: "filesystem-1",
      quota_mode: "simple",
    });

    expect(first.quota_epoch).toBe(1);
    expect(second.quota_epoch).toBe(1);
    expect(state.currentProjectVolumeQuotaEpoch()).toBe("filesystem-1:1");

    state.resetProjectFilesystemQuotaStateForTests();
    const afterRestart = state.reconcileProjectFilesystemQuotaState({
      mountpoint: "/mnt/cocalc",
      filesystem_uuid: "filesystem-1",
      quota_mode: "simple",
    });
    expect(afterRestart.quota_epoch).toBe(1);
  });

  it("increments the epoch for identity and quota-mode changes", async () => {
    const state = await import("./filesystem-quota-state");
    state.reconcileProjectFilesystemQuotaState({
      mountpoint: "/mnt/cocalc",
      filesystem_uuid: "filesystem-1",
      quota_mode: "simple",
    });
    expect(
      state.reconcileProjectFilesystemQuotaState({
        mountpoint: "/mnt/cocalc",
        filesystem_uuid: "filesystem-1",
        quota_mode: "disabled",
      }).quota_epoch,
    ).toBe(2);
    expect(
      state.reconcileProjectFilesystemQuotaState({
        mountpoint: "/mnt/cocalc",
        filesystem_uuid: "filesystem-2",
        quota_mode: "simple",
      }).quota_epoch,
    ).toBe(3);
    expect(
      state.reconcileProjectFilesystemQuotaState({
        mountpoint: "/mnt/cocalc",
        filesystem_uuid: "filesystem-2",
        quota_mode: "simple",
        quota_mode_reconciled: true,
      }).quota_epoch,
    ).toBe(4);
  });
});
