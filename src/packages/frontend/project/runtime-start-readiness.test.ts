import { Map as ImmutableMap } from "immutable";

import {
  getProjectRuntimePreparation,
  isProjectRuntimePreparing,
  normalizeStartLro,
} from "./runtime-start-readiness";

describe("project runtime start readiness", () => {
  it("uses an active start LRO before the lifecycle projection catches up", () => {
    expect(
      getProjectRuntimePreparation({
        projectState: "opened",
        startLro: {
          summary: { status: "running" },
          last_progress: { phase: "cache_rootfs" },
        },
      }),
    ).toEqual({ active: true, phase: "cache_rootfs" });
  });

  it("accepts immutable start records from the project redux store", () => {
    const startLro = ImmutableMap({
      summary: ImmutableMap({ status: "queued" }),
      last_progress: ImmutableMap({ phase: "prepare_config" }),
    });
    expect(normalizeStartLro(startLro)?.summary?.status).toBe("queued");
    expect(
      getProjectRuntimePreparation({ projectState: "opened", startLro }),
    ).toEqual({ active: true, phase: "prepare_config" });
  });

  it("keeps lifecycle-only startup guarded while progress catches up", () => {
    expect(isProjectRuntimePreparing({ projectState: "starting" })).toBe(true);
    expect(isProjectRuntimePreparing({ projectState: "opening" })).toBe(true);
  });

  it("stops guarding when the running projection arrives", () => {
    expect(
      isProjectRuntimePreparing({
        projectState: "running",
        startLro: { summary: { status: "running" } },
      }),
    ).toBe(false);
    expect(
      isProjectRuntimePreparing({
        projectState: "opened",
        startLro: { summary: { status: "succeeded" } },
      }),
    ).toBe(false);
  });
});
