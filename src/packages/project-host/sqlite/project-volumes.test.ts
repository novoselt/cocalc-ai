const filesystemUuid = "11111111-2222-4333-8444-555555555555";

describe("managed project volume inventory", () => {
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

  it("tracks stable identity, replacement, and deletion", async () => {
    const inventory = await import("./project-volumes");
    const first = inventory.recordProjectVolume({
      project_id: "project-1",
      volume_kind: "home",
      mountpoint: "/mnt/cocalc",
      relative_path: "project-project-1",
      identity: {
        filesystem_uuid: filesystemUuid,
        subvolume_id: 256,
        volume_uuid: "volume-1",
      },
    });
    const unchanged = inventory.recordProjectVolume({
      project_id: "project-1",
      volume_kind: "home",
      mountpoint: "/mnt/cocalc",
      relative_path: "project-project-1",
      identity: {
        filesystem_uuid: filesystemUuid,
        subvolume_id: 256,
        volume_uuid: "volume-1",
        generation: 99,
      },
    });
    const replaced = inventory.recordProjectVolume({
      project_id: "project-1",
      volume_kind: "home",
      mountpoint: "/mnt/cocalc",
      relative_path: "project-project-1",
      identity: {
        filesystem_uuid: filesystemUuid,
        subvolume_id: 300,
        volume_uuid: "volume-2",
      },
    });

    expect(first.changed).toBe(true);
    expect(unchanged.changed).toBe(false);
    expect(replaced.changed).toBe(true);
    expect(
      inventory.getRecordedProjectVolumeIdentity("project-1", "home"),
    ).toBe(`${filesystemUuid}:volume-2:300`);
    expect(inventory.markProjectVolumeAbsent("project-1", "home")).toBe(true);
    expect(
      inventory.getRecordedProjectVolumeIdentity("project-1", "home"),
    ).toBeUndefined();
  });

  it("bootstraps a large legacy inventory atomically and only once", async () => {
    const inventory = await import("./project-volumes");
    const volumes = Array.from({ length: 10_000 }, (_, index) => {
      const project_id = `project-${`${index}`.padStart(5, "0")}`;
      return {
        project_id,
        volume_kind: "home" as const,
        mountpoint: "/mnt/cocalc",
        relative_path: `project-${project_id}`,
        identity: {
          filesystem_uuid: filesystemUuid,
          subvolume_id: 256 + index,
          volume_uuid: `volume-${index}`,
        },
      };
    });

    inventory.bootstrapProjectVolumeInventory({
      filesystem_uuid: filesystemUuid,
      mountpoint: "/mnt/cocalc",
      volumes,
    });

    expect(inventory.projectVolumeInventoryBootstrapped(filesystemUuid)).toBe(
      true,
    );
    expect(inventory.listProvisionedProjectIds()).toHaveLength(10_000);
    expect(inventory.nextProjectVolumeVerificationBatch(32)).toHaveLength(32);
  });
});
