import { evaluatePersistMaintenanceCandidate } from "@cocalc/conat/persist/maintenance/candidates";

const policy = {
  now: 1_000_000,
  idleMs: 1000,
  minFileBytes: 100,
  minReclaimBytes: 25,
  minReclaimRatio: 0.25,
  minBetweenMs: 5000,
  maxFileBytes: 1000,
};

const candidate = {
  physicalPath: "/tmp/a.db",
  fileSizeBytes: 100,
  reclaimableBytes: 25,
  reclaimableRatio: 0.25,
  lastActivityAt: 900_000,
  lastCompactedAt: 900_000,
  retryAfter: 0,
  openOwners: 0,
};

describe("persist maintenance candidate policy", () => {
  it("accepts a candidate exactly at all lower bounds", () => {
    expect(evaluatePersistMaintenanceCandidate(candidate, policy)).toEqual({
      eligible: true,
    });
  });

  it.each([
    ["open", { openOwners: 1 }],
    ["active", { lastActivityAt: policy.now }],
    ["recently-compacted", { lastCompactedAt: policy.now }],
    ["retry-cooldown", { retryAfter: policy.now + 1 }],
    ["too-small", { fileSizeBytes: 99 }],
    ["too-large", { fileSizeBytes: 1001 }],
    ["insufficient-reclaim-bytes", { reclaimableBytes: 24 }],
    ["insufficient-reclaim-ratio", { reclaimableRatio: 0.24 }],
  ])("rejects %s", (reason, delta) => {
    expect(
      evaluatePersistMaintenanceCandidate({ ...candidate, ...delta }, policy),
    ).toEqual({ eligible: false, reason });
  });
});
