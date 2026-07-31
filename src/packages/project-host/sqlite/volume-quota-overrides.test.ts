describe("project volume quota overrides", () => {
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

  it("uses the maximum persistent or active minimum", async () => {
    const overrides = await import("./volume-quota-overrides");
    overrides.createProjectVolumeQuotaOverride({
      override_id: "override-1",
      project_id: "project-1",
      volume_kind: "home",
      operation_id: "operation-1",
      kind: "snapshot_cleanup",
      minimum_bytes: 150,
    });
    overrides.createProjectVolumeQuotaOverride({
      override_id: "override-2",
      project_id: "project-1",
      volume_kind: "home",
      operation_id: "operation-2",
      kind: "archive_restore",
      minimum_bytes: 200,
    });

    expect(
      overrides.effectiveProjectVolumeQuotaBytes({
        project_id: "project-1",
        volume_kind: "home",
        persistent_bytes: 100,
      }).effective_bytes,
    ).toBe(200);

    overrides.releaseProjectVolumeQuotaOverride("override-2");
    expect(
      overrides.effectiveProjectVolumeQuotaBytes({
        project_id: "project-1",
        volume_kind: "home",
        persistent_bytes: 100,
      }).effective_bytes,
    ).toBe(150);

    overrides.releaseProjectVolumeQuotaOverride("override-1");
    expect(
      overrides.effectiveProjectVolumeQuotaBytes({
        project_id: "project-1",
        volume_kind: "home",
        persistent_bytes: 100,
      }).effective_bytes,
    ).toBe(100);
  });

  it("is idempotent for one operation and rejects conflicting retries", async () => {
    const overrides = await import("./volume-quota-overrides");
    const opts = {
      project_id: "project-1",
      volume_kind: "home" as const,
      operation_id: "operation-1",
      kind: "snapshot_cleanup",
      minimum_bytes: 150,
      expires_at: 500,
    };
    const first = overrides.createProjectVolumeQuotaOverride(opts);
    const second = overrides.createProjectVolumeQuotaOverride(opts);
    expect(second.override_id).toBe(first.override_id);
    expect(() =>
      overrides.createProjectVolumeQuotaOverride({
        ...opts,
        minimum_bytes: 151,
      }),
    ).toThrow("conflicting temporary quota override");
  });

  it("lists expired claims without treating expiry as release", async () => {
    const overrides = await import("./volume-quota-overrides");
    overrides.createProjectVolumeQuotaOverride({
      project_id: "project-1",
      volume_kind: "home",
      operation_id: "expired",
      kind: "snapshot_cleanup",
      minimum_bytes: 150,
      expires_at: 100,
    });
    overrides.createProjectVolumeQuotaOverride({
      project_id: "project-2",
      volume_kind: "home",
      operation_id: "current",
      kind: "snapshot_cleanup",
      minimum_bytes: 150,
      expires_at: 300,
    });

    expect(
      overrides
        .listUnreleasedProjectVolumeQuotaOverrides({ expired_before: 200 })
        .map(({ operation_id }) => operation_id),
    ).toEqual(["expired"]);
    expect(
      overrides.effectiveProjectVolumeQuotaBytes({
        project_id: "project-1",
        volume_kind: "home",
        persistent_bytes: 100,
      }).effective_bytes,
    ).toBe(150);
  });
});
