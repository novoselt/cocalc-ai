describe("project volume quota ledger", () => {
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

  it("accepts monotonic desired state and rejects stale updates", async () => {
    const ledger = await import("./volume-quotas");
    const first = ledger.acceptProjectVolumeQuotaDesired({
      project_id: "project-1",
      volume_kind: "home",
      desired_bytes: 10,
      desired_revision: 2,
    });
    expect(first.status).toBe("accepted");

    const stale = ledger.acceptProjectVolumeQuotaDesired({
      project_id: "project-1",
      volume_kind: "home",
      desired_bytes: 5,
      desired_revision: 1,
    });
    expect(stale.status).toBe("stale");
    expect(stale.row.desired_bytes).toBe(10);
    expect(stale.row.desired_revision).toBe(2);
  });

  it("rejects conflicting values at one revision", async () => {
    const ledger = await import("./volume-quotas");
    ledger.acceptProjectVolumeQuotaDesired({
      project_id: "project-1",
      volume_kind: "home",
      desired_bytes: 10,
      desired_revision: 2,
    });
    expect(() =>
      ledger.acceptProjectVolumeQuotaDesired({
        project_id: "project-1",
        volume_kind: "home",
        desired_bytes: 11,
        desired_revision: 2,
      }),
    ).toThrow("conflicting home quota");
  });

  it("allows legacy revision-zero desired state to advance until versioned state arrives", async () => {
    const ledger = await import("./volume-quotas");
    ledger.acceptProjectVolumeQuotaDesired({
      project_id: "project-1",
      volume_kind: "home",
      desired_bytes: 10,
    });
    const legacyUpdate = ledger.acceptProjectVolumeQuotaDesired({
      project_id: "project-1",
      volume_kind: "home",
      desired_bytes: 11,
    });
    expect(legacyUpdate.status).toBe("accepted");
    expect(legacyUpdate.row.desired_bytes).toBe(11);

    ledger.acceptProjectVolumeQuotaDesired({
      project_id: "project-1",
      volume_kind: "home",
      desired_bytes: 12,
      desired_revision: 1,
    });
    const staleLegacy = ledger.acceptProjectVolumeQuotaDesired({
      project_id: "project-1",
      volume_kind: "home",
      desired_bytes: 13,
    });
    expect(staleLegacy.status).toBe("stale");
    expect(staleLegacy.row.desired_bytes).toBe(12);
  });

  it("marks only the current desired revision as applied", async () => {
    const ledger = await import("./volume-quotas");
    ledger.acceptProjectVolumeQuotaDesired({
      project_id: "project-1",
      volume_kind: "home",
      desired_bytes: 10,
      desired_revision: 2,
    });
    expect(
      ledger.markProjectVolumeQuotaApplied({
        project_id: "project-1",
        volume_kind: "home",
        desired_bytes: 9,
        desired_revision: 1,
      }),
    ).toBe(false);
    expect(
      ledger.markProjectVolumeQuotaApplied({
        project_id: "project-1",
        volume_kind: "home",
        desired_bytes: 10,
        desired_revision: 2,
      }),
    ).toBe(true);
    const row = ledger.getProjectVolumeQuota("project-1", "home")!;
    expect(ledger.projectVolumeQuotaIsApplied(row)).toBe(true);
  });

  it("invalidates applied state across a process or volume epoch", async () => {
    const ledger = await import("./volume-quotas");
    ledger.acceptProjectVolumeQuotaDesired({
      project_id: "project-1",
      volume_kind: "home",
      desired_bytes: 10,
      desired_revision: 2,
    });
    ledger.markProjectVolumeQuotaApplied({
      project_id: "project-1",
      volume_kind: "home",
      desired_bytes: 10,
      desired_revision: 2,
      volume_identity: "volume-1",
    });
    const row = ledger.getProjectVolumeQuota("project-1", "home")!;
    expect(
      ledger.projectVolumeQuotaIsApplied(row, {
        volume_identity: "volume-1",
      }),
    ).toBe(true);
    expect(
      ledger.projectVolumeQuotaIsApplied(row, {
        volume_identity: "volume-2",
      }),
    ).toBe(false);
    expect(
      ledger.projectVolumeQuotaIsApplied(row, {
        epoch: "different-process",
      }),
    ).toBe(false);
  });
});
