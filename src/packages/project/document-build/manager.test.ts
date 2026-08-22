/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  BuildDocumentIdentity,
  DocumentBuildRequest,
} from "@cocalc/app-document-build";
import {
  DocumentBuildManager,
  type DocumentBuildExecutionControl,
  type DocumentBuildExecutionResult,
} from "./manager";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const success = (): DocumentBuildExecutionResult => ({
  state: "succeeded",
  exit_code: 0,
  stages: [],
  diagnostics: [],
  dependencies: [],
  artifacts: [],
});

function identity(path: string): BuildDocumentIdentity {
  const logical_path = path.startsWith("/") ? path : `/home/user/${path}`;
  const working_path = logical_path.replace(/\.(?:Rnw|Rtex)$/i, ".tex");
  return {
    kind: /\.R(?:nw|tex)$/i.test(logical_path) ? "knitr" : "latex",
    logical_path,
    working_path,
    resource_key: working_path,
  };
}

function manager(
  execute: (
    request: DocumentBuildRequest,
    identity: BuildDocumentIdentity,
    control: DocumentBuildExecutionControl,
  ) => Promise<DocumentBuildExecutionResult>,
  options: Record<string, unknown> = {},
) {
  return new DocumentBuildManager({
    capabilities: () => ({}) as any,
    resolveIdentity: identity,
    execute,
    ...options,
  });
}

describe("DocumentBuildManager", () => {
  it("deduplicates the same resource generation", async () => {
    const gate = deferred<DocumentBuildExecutionResult>();
    const execute = jest.fn(() => gate.promise);
    const builds = manager(execute);
    const first = builds.start({ path: "paper.tex", generation: "42" });
    const second = builds.start({
      path: "/home/user/paper.tex",
      generation: "42",
    });
    expect(second.build_id).toBe(first.build_id);
    expect(execute).toHaveBeenCalledTimes(1);
    gate.resolve(success());
    await new Promise(setImmediate);
    expect(builds.get(first.build_id).state).toBe("succeeded");
  });

  it("joins an active forced generation but rebuilds a completed one", async () => {
    const gates = [
      deferred<DocumentBuildExecutionResult>(),
      deferred<DocumentBuildExecutionResult>(),
    ];
    const execute = jest
      .fn()
      .mockImplementationOnce(() => gates[0].promise)
      .mockImplementationOnce(() => gates[1].promise);
    const builds = manager(execute);
    const first = builds.start({
      path: "paper.tex",
      generation: "42",
      force: true,
    });
    const joined = builds.start({
      path: "paper.tex",
      generation: "42",
      force: true,
    });
    expect(joined.build_id).toBe(first.build_id);
    expect(execute).toHaveBeenCalledTimes(1);

    gates[0].resolve(success());
    await new Promise(setImmediate);
    const rebuilt = builds.start({
      path: "paper.tex",
      generation: "42",
      force: true,
    });
    expect(rebuilt.build_id).not.toBe(first.build_id);
    expect(execute).toHaveBeenCalledTimes(2);
    gates[1].resolve(success());
    await new Promise(setImmediate);
  });

  it("serializes Knitr and LaTeX that share generated files", async () => {
    const gates = [
      deferred<DocumentBuildExecutionResult>(),
      deferred<DocumentBuildExecutionResult>(),
    ];
    const execute = jest
      .fn()
      .mockImplementationOnce(() => gates[0].promise)
      .mockImplementationOnce(() => gates[1].promise);
    const builds = manager(execute, { maxActive: 2 });
    const knitr = builds.start({ path: "paper.Rnw", generation: "saved-1" });
    const latex = builds.start({ path: "paper.tex", generation: "saved-1" });
    expect(latex.build_id).not.toBe(knitr.build_id);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(builds.get(latex.build_id).state).toBe("queued");
    expect(
      builds.getActive({ path: "paper.Rnw" }).map(({ build_id }) => build_id),
    ).toEqual([knitr.build_id, latex.build_id]);
    gates[0].resolve(success());
    await new Promise(setImmediate);
    expect(execute).toHaveBeenCalledTimes(2);
    gates[1].resolve(success());
    await new Promise(setImmediate);
    expect(builds.get(knitr.build_id).state).toBe("succeeded");
    expect(builds.get(latex.build_id).state).toBe("succeeded");
    expect(
      builds.getRecent({ path: "paper.Rnw" }).map(({ build_id }) => build_id),
    ).toEqual(expect.arrayContaining([knitr.build_id, latex.build_id]));
  });

  it("does not join generations with different execution inputs", async () => {
    const gates = [
      deferred<DocumentBuildExecutionResult>(),
      deferred<DocumentBuildExecutionResult>(),
      deferred<DocumentBuildExecutionResult>(),
    ];
    let index = 0;
    const execute = jest.fn(() => gates[index++].promise);
    const builds = manager(execute, { maxActive: 1 });
    const first = builds.start({
      path: "paper.tex",
      generation: "saved-1",
      expected_source_hash: 1,
      output_directory: "/tmp/a",
    });
    const changedSource = builds.start({
      path: "paper.tex",
      generation: "saved-1",
      expected_source_hash: 2,
      output_directory: "/tmp/a",
    });
    const forced = builds.start({
      path: "paper.tex",
      generation: "saved-1",
      expected_source_hash: 1,
      output_directory: "/tmp/a",
      force: true,
    });
    expect(
      new Set([first.build_id, changedSource.build_id, forced.build_id]).size,
    ).toBe(3);

    for (const gate of gates) {
      gate.resolve(success());
      await new Promise(setImmediate);
    }
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("distinguishes default and explicitly disabled output directories", async () => {
    const execute = jest.fn(async () => success());
    const builds = manager(execute);
    const defaultOutput = builds.start({
      path: "paper.tex",
      generation: "saved-1",
    });
    await new Promise(setImmediate);
    const disabledOutput = builds.start({
      path: "paper.tex",
      generation: "saved-1",
      output_directory: null,
    });

    expect(disabledOutput.build_id).not.toBe(defaultOutput.build_id);
    await new Promise(setImmediate);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("runs independent resources concurrently", async () => {
    const gates = [
      deferred<DocumentBuildExecutionResult>(),
      deferred<DocumentBuildExecutionResult>(),
    ];
    let i = 0;
    const execute = jest.fn(() => gates[i++].promise);
    const builds = manager(execute, { maxActive: 2 });
    const a = builds.start({ path: "a.tex" });
    const b = builds.start({ path: "b.tex" });
    expect(execute).toHaveBeenCalledTimes(2);
    gates.forEach((gate) => gate.resolve(success()));
    await new Promise(setImmediate);
    expect(builds.get(a.build_id).state).toBe("succeeded");
    expect(builds.get(b.build_id).state).toBe("succeeded");
  });

  it("cancels a queued build without starting it", async () => {
    const gate = deferred<DocumentBuildExecutionResult>();
    const execute = jest.fn(() => gate.promise);
    const builds = manager(execute, { maxActive: 1 });
    const active = builds.start({ path: "a.tex" });
    const queued = builds.start({ path: "b.tex" });
    const canceled = await builds.cancel(queued.build_id);
    expect(canceled.state).toBe("canceled");
    expect(canceled.exit_code).toBe(130);
    expect(execute).toHaveBeenCalledTimes(1);
    gate.resolve(success());
    await new Promise(setImmediate);
    expect(builds.get(active.build_id).state).toBe("succeeded");
  });

  it("cancels the active subprocess and records one terminal result", async () => {
    const gate = deferred<DocumentBuildExecutionResult>();
    const cancelActive = jest.fn(async () => gate.resolve(success()));
    const execute = jest.fn(
      async (
        _request: DocumentBuildRequest,
        _identity: BuildDocumentIdentity,
        control: DocumentBuildExecutionControl,
      ) => {
        control.setCancelActive(cancelActive);
        return await gate.promise;
      },
    );
    const builds = manager(execute);
    const started = builds.start({ path: "paper.tex" });

    const canceled = await builds.cancel(started.build_id);
    expect(cancelActive).toHaveBeenCalledTimes(1);
    expect(canceled).toMatchObject({ state: "canceled", exit_code: 130 });
    await new Promise(setImmediate);
    expect(builds.get(started.build_id)).toMatchObject({
      state: "canceled",
      exit_code: 130,
    });
  });

  it("bounds queued admission", async () => {
    const gate = deferred<DocumentBuildExecutionResult>();
    const builds = manager(() => gate.promise, {
      maxActive: 1,
      maxQueued: 1,
    });
    builds.start({ path: "active.tex" });
    builds.start({ path: "queued.tex" });
    expect(() => builds.start({ path: "rejected.tex" })).toThrow(
      "document build queue is full",
    );
    gate.resolve(success());
    await new Promise(setImmediate);
    await new Promise(setImmediate);
  });

  it("expires retained results and their generation mapping", async () => {
    const execute = jest.fn(async () => success());
    const builds = manager(execute, { completedTtlMs: 5 });
    const first = builds.start({ path: "paper.tex", generation: "42" });
    await new Promise(setImmediate);
    expect(builds.get(first.build_id).state).toBe("succeeded");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(() => builds.get(first.build_id)).toThrow("does not exist");
    const second = builds.start({ path: "paper.tex", generation: "42" });
    expect(second.build_id).not.toBe(first.build_id);
    await new Promise(setImmediate);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("removes generation mappings when count-based retention evicts a build", async () => {
    const execute = jest.fn(async () => success());
    const builds = manager(execute, { completedMax: 1 });
    const first = builds.start({ path: "paper.tex", generation: "saved-1" });
    await new Promise(setImmediate);
    builds.start({ path: "other.tex", generation: "saved-2" });
    await new Promise(setImmediate);

    expect(() => builds.get(first.build_id)).toThrow("does not exist");
    const restarted = builds.start({
      path: "paper.tex",
      generation: "saved-1",
    });
    expect(restarted.build_id).not.toBe(first.build_id);
    await new Promise(setImmediate);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("returns bounded retained snapshots by logical document", async () => {
    const builds = manager(async () => success());
    const first = builds.start({ path: "paper.Rnw" });
    await new Promise(setImmediate);
    builds.start({ path: "other.tex" });
    await new Promise(setImmediate);

    expect(builds.getRecent({ path: "paper.Rnw", limit: 1 })).toEqual([
      expect.objectContaining({ build_id: first.build_id, state: "succeeded" }),
    ]);
    expect(() => builds.getRecent({ limit: 0 })).toThrow(
      "recent limit must be between 1 and 100",
    );
  });

  it("still finishes cancellation when the subprocess cancel callback fails", async () => {
    const gate = deferred<DocumentBuildExecutionResult>();
    const builds = manager(async (_request, _identity, control) => {
      control.setCancelActive(async () => {
        gate.resolve(success());
        throw new Error("cancel transport failed");
      });
      return await gate.promise;
    });
    const started = builds.start({ path: "paper.tex" });

    await expect(builds.cancel(started.build_id)).resolves.toMatchObject({
      state: "canceled",
      exit_code: 130,
    });
  });

  it("starts the deadline only after leaving the queue", async () => {
    jest.useFakeTimers();
    try {
      const first = deferred<DocumentBuildExecutionResult>();
      const execute = jest
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(
          (_request, _identity, control: DocumentBuildExecutionControl) =>
            new Promise<DocumentBuildExecutionResult>((_resolve, reject) => {
              control.signal.addEventListener("abort", () =>
                reject(new Error("aborted")),
              );
            }),
        );
      const builds = manager(execute, { maxActive: 1 });
      builds.start({ path: "a.tex", build_timeout_ms: 100 });
      const queued = builds.start({ path: "b.tex", build_timeout_ms: 100 });
      await jest.advanceTimersByTimeAsync(90);
      expect(builds.get(queued.build_id).state).toBe("queued");
      first.resolve(success());
      await Promise.resolve();
      await Promise.resolve();
      expect(builds.get(queued.build_id).state).toBe("running");
      await jest.advanceTimersByTimeAsync(101);
      expect(builds.get(queued.build_id).state).toBe("timed_out");
    } finally {
      jest.useRealTimers();
    }
  });

  it("publishes monotonically increasing snapshots", async () => {
    const snapshots: any[] = [];
    const builds = manager(
      async (_request, _identity, control) => {
        control.update({
          diagnostics: [{ level: "warning", message: "test" }],
        } as any);
        return success();
      },
      { publish: (snapshot) => snapshots.push(snapshot) },
    );
    const build = builds.start({ path: "paper.tex" });
    await new Promise(setImmediate);
    expect(builds.get(build.build_id).state).toBe("succeeded");
    expect(snapshots.map(({ seq }) => seq)).toEqual([1, 2, 3, 4]);
  });
});
