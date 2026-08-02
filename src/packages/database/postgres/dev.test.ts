import {
  buildLocalPostgresArchiveScript,
  resolveLocalPostgresArchiveTimeout,
} from "./dev";

describe("resolveLocalPostgresArchiveTimeout", () => {
  const original = process.env.COCALC_LOCAL_PG_ARCHIVE_TIMEOUT;

  afterEach(() => {
    if (original == null) {
      delete process.env.COCALC_LOCAL_PG_ARCHIVE_TIMEOUT;
    } else {
      process.env.COCALC_LOCAL_PG_ARCHIVE_TIMEOUT = original;
    }
  });

  it("defaults to one hour", () => {
    delete process.env.COCALC_LOCAL_PG_ARCHIVE_TIMEOUT;
    expect(resolveLocalPostgresArchiveTimeout()).toBe("1h");
  });

  it("uses the configured override", () => {
    process.env.COCALC_LOCAL_PG_ARCHIVE_TIMEOUT = "15min";
    expect(resolveLocalPostgresArchiveTimeout()).toBe("15min");
  });

  it("ignores blank overrides", () => {
    process.env.COCALC_LOCAL_PG_ARCHIVE_TIMEOUT = "   ";
    expect(resolveLocalPostgresArchiveTimeout()).toBe("1h");
  });
});

describe("buildLocalPostgresArchiveScript", () => {
  it("fails before creating WAL directories when the backup mount is absent", () => {
    const script = buildLocalPostgresArchiveScript({
      backupRoot: "/mnt/cocalc-backups",
      walArchiveDir: "/mnt/cocalc-backups/bay-backups/bay-0/wal/archive",
      requireSeparateFilesystem: true,
    });

    expect(script).toContain('if [ ! -d "$BACKUP_ROOT" ]');
    expect(script).toContain('stat -c %d "$BACKUP_ROOT"');
    expect(script).toContain('if [ "$ROOT_DEVICE" = "$PARENT_DEVICE" ]');
    expect(
      script.indexOf("backup root is not a separate filesystem"),
    ).toBeLessThan(script.indexOf('mkdir -p "$DEST_DIR"'));
  });

  it("keeps the existing local-development archive behavior by default", () => {
    const script = buildLocalPostgresArchiveScript({
      backupRoot: "/tmp/cocalc",
      walArchiveDir: "/tmp/cocalc/wal/archive",
      requireSeparateFilesystem: false,
    });

    expect(script).not.toContain("ROOT_DEVICE");
    expect(script).toContain('mkdir -p "$DEST_DIR"');
  });
});
