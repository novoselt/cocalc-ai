import { legacyRestoreTemporaryQuotaBytes } from "./project-archive";

describe("legacy project archive quota headroom", () => {
  it("covers current usage plus the full archive during extraction", () => {
    const current_used_bytes = 4_000_000_000;
    const archive_uncompressed_bytes = 3_000_000_000;
    const minimum = legacyRestoreTemporaryQuotaBytes({
      previous_quota_bytes: 5_000_000_000,
      current_used_bytes,
      archive_uncompressed_bytes,
    });

    expect(minimum).toBeGreaterThanOrEqual(
      current_used_bytes + archive_uncompressed_bytes,
    );
  });
});
