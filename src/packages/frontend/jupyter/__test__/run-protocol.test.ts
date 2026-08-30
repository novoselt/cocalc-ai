import {
  classifyRunStreamEnd,
  classifyRunStreamMessage,
  getRunLifecycleType,
  shouldReplayLiveRunSnapshot,
} from "../run-protocol";

describe("jupyter run protocol classification", () => {
  it("distinguishes completion from transport loss", () => {
    expect(
      classifyRunStreamEnd({ sawRunDone: true, socketState: "closed" }),
    ).toBe("complete");
    expect(
      classifyRunStreamEnd({ sawRunDone: false, socketState: "ready" }),
    ).toBe("complete");
    expect(
      classifyRunStreamEnd({ sawRunDone: false, socketState: "closed" }),
    ).toBe("transport_lost");
  });

  it("replays a completed snapshot when disconnect recovery requires it", () => {
    expect(
      shouldReplayLiveRunSnapshot({
        done: true,
        needsCompletionReplay: true,
      }),
    ).toBe(true);
    expect(
      shouldReplayLiveRunSnapshot({
        done: true,
        needsCompletionReplay: false,
      }),
    ).toBe(false);
  });

  it("parses lifecycle from either lifecycle or msg_type field", () => {
    expect(getRunLifecycleType({ lifecycle: "cell_start" })).toBe("cell_start");
    expect(getRunLifecycleType({ msg_type: "cell_done" })).toBe("cell_done");
    expect(getRunLifecycleType({ msg_type: "stream" })).toBeNull();
  });

  it("drops stale messages from an older run id", () => {
    const decision = classifyRunStreamMessage({
      message: { id: "c1", run_id: "old-run", msg_type: "stream" },
      activeRunId: "new-run",
      finalizedCells: new Set<string>(),
    });
    expect(decision).toEqual({
      kind: "drop_stale_run_id",
      mesgRunId: "old-run",
    });
  });

  it("accepts active-run messages during rerun/reconnect", () => {
    const decision = classifyRunStreamMessage({
      message: { id: "c1", run_id: "new-run", msg_type: "stream" },
      activeRunId: "new-run",
      finalizedCells: new Set<string>(),
    });
    expect(decision).toEqual({ kind: "data", id: "c1" });
  });

  it("requires ids for cell lifecycle messages", () => {
    const decision = classifyRunStreamMessage({
      message: { run_id: "r1", lifecycle: "cell_start" },
      activeRunId: "r1",
      finalizedCells: new Set<string>(),
    });
    expect(decision).toEqual({
      kind: "drop_missing_id",
      source: "lifecycle",
    });
  });

  it("drops non-lifecycle output after cell finalization", () => {
    const finalized = new Set<string>(["c1"]);
    const decision = classifyRunStreamMessage({
      message: { id: "c1", run_id: "r1", msg_type: "stream" },
      activeRunId: "r1",
      finalizedCells: finalized,
    });
    expect(decision).toEqual({ kind: "drop_after_finalize", id: "c1" });
  });

  it("drops lifecycle output after cell finalization", () => {
    const finalized = new Set<string>(["c1"]);
    const decision = classifyRunStreamMessage({
      message: { id: "c1", run_id: "r1", lifecycle: "cell_done" },
      activeRunId: "r1",
      finalizedCells: finalized,
    });
    expect(decision).toEqual({ kind: "drop_after_finalize", id: "c1" });
  });
});
