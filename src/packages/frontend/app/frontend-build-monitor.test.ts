import {
  isFrontendBuildMismatch,
  isLikelyStaleChunkError,
} from "./frontend-build-monitor";

describe("frontend build monitor", () => {
  const manifest = {
    schema: 1 as const,
    git_revision: "abc",
    build_timestamp: 123,
    build_date: "2026-08-12T00:00:00.000Z",
    fingerprint: "current-build",
  };

  it("detects upgrades and rollbacks by immutable build identity", () => {
    expect(isFrontendBuildMismatch(manifest, "current-build")).toBe(false);
    expect(isFrontendBuildMismatch(manifest, "other-build")).toBe(true);
    expect(isFrontendBuildMismatch(manifest, "N/A")).toBe(false);
  });

  it("recognizes stale runtime and chunk failures", () => {
    expect(isLikelyStaleChunkError(new Error("ChunkLoadError: failed"))).toBe(
      true,
    );
    expect(
      isLikelyStaleChunkError({
        reason: new Error("__webpack_modules__[id] is undefined"),
      }),
    ).toBe(true);
    expect(isLikelyStaleChunkError(new Error("ordinary failure"))).toBe(false);
  });
});
