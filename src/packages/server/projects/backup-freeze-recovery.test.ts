import { ARCHIVE_BACKUP_SOURCE_RELEASED_ERROR_CODE } from "@cocalc/conat/files/file-server";
import {
  archiveBackupFreezeFailureResult,
  createBackupFreezeRecovery,
  isArchiveBackupFailureReopenSafe,
} from "./backup-freeze-recovery";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("backup freeze recovery", () => {
  const options = {
    enabled: true,
    op_id: "backup-op-1",
    project_id: "11111111-1111-4111-8111-111111111111",
    host_id: "22222222-2222-4222-8222-222222222222",
  };

  it("releases a frozen backup that completes after its caller gives up", async () => {
    const releaseArchiveFreeze = jest.fn(async () => ({
      status: "released" as const,
    }));
    const attestReleased = jest.fn(async () => undefined);
    const recovery = createBackupFreezeRecovery({
      ...options,
      releaseArchiveFreeze,
      attestReleased,
    });
    const operation = deferred<{ id: string; generation: number }>();
    const watched = recovery.watch(operation.promise, "worker timed out");

    operation.resolve({ id: "backup-1", generation: 42 });
    await watched;

    expect(releaseArchiveFreeze).toHaveBeenCalledWith({
      project_id: options.project_id,
      host_id: options.host_id,
      expected_generation: 42,
    });
    expect(attestReleased).toHaveBeenCalledWith(options.op_id);
  });

  it("does not release a freeze after its result is durably handed off", async () => {
    const releaseArchiveFreeze = jest.fn(async () => ({
      status: "released" as const,
    }));
    const recovery = createBackupFreezeRecovery({
      ...options,
      releaseArchiveFreeze,
    });
    const operation = deferred<{ id: string; generation: number }>();
    const watched = recovery.watch(operation.promise, "worker timed out");

    recovery.handoff();
    operation.resolve({ id: "backup-1", generation: 42 });
    await watched;

    expect(releaseArchiveFreeze).not.toHaveBeenCalled();
  });

  it("does not release when freezing is disabled or the host operation fails", async () => {
    const releaseArchiveFreeze = jest.fn(async () => ({
      status: "released" as const,
    }));
    const disabled = createBackupFreezeRecovery({
      ...options,
      enabled: false,
      releaseArchiveFreeze,
    });
    expect(
      disabled.watch(Promise.resolve({ generation: 42 }), "not frozen"),
    ).toBeUndefined();

    const recovery = createBackupFreezeRecovery({
      ...options,
      releaseArchiveFreeze,
    });
    await recovery.watch(
      Promise.reject(new Error("host backup failed")),
      "failed",
    );

    expect(releaseArchiveFreeze).not.toHaveBeenCalled();
  });

  it("attests a late host failure that confirms its source was released", async () => {
    const releaseArchiveFreeze = jest.fn(async () => ({
      status: "released" as const,
    }));
    const attestReleased = jest.fn(async () => undefined);
    const recovery = createBackupFreezeRecovery({
      ...options,
      releaseArchiveFreeze,
      attestReleased,
    });

    await recovery.watch(
      Promise.reject(
        Object.assign(new Error("host backup failed after cleanup"), {
          code: ARCHIVE_BACKUP_SOURCE_RELEASED_ERROR_CODE,
        }),
      ),
      "failed late",
    );

    expect(releaseArchiveFreeze).not.toHaveBeenCalled();
    expect(attestReleased).toHaveBeenCalledWith(options.op_id);
  });

  it("attests not-started only after a late pre-host failure settles", async () => {
    const attestNotStarted = jest.fn(async () => undefined);
    const recovery = createBackupFreezeRecovery({
      ...options,
      attestNotStarted,
    });
    const operation = deferred<{ id: string; generation: number }>();
    const watched = recovery.watch(
      operation.promise,
      "host watch won before RPC",
      () => false,
    );

    operation.reject(new Error("file server never became ready"));
    await watched;

    expect(attestNotStarted).toHaveBeenCalledWith(options.op_id);
  });

  it("attests only failures that never reached the host or were explicitly released", () => {
    const notStarted = archiveBackupFreezeFailureResult({
      enabled: true,
      hostOperationStarted: false,
      error: new Error("host unavailable"),
    });
    const released = archiveBackupFreezeFailureResult({
      enabled: true,
      hostOperationStarted: true,
      error: Object.assign(new Error("R2 unavailable"), {
        code: ARCHIVE_BACKUP_SOURCE_RELEASED_ERROR_CODE,
      }),
    });
    const uncertain = archiveBackupFreezeFailureResult({
      enabled: true,
      hostOperationStarted: true,
      error: new Error("timeout"),
    });
    const unresolvedPreHost = archiveBackupFreezeFailureResult({
      enabled: true,
      hostOperationStarted: false,
      operationSettled: false,
      error: new Error("host watch won"),
    });

    expect(notStarted).toEqual({ archive_freeze_recovery: "not-started" });
    expect(released).toEqual({ archive_freeze_recovery: "released" });
    expect(uncertain).toEqual({ archive_freeze_recovery: "uncertain" });
    expect(unresolvedPreHost).toEqual({
      archive_freeze_recovery: "uncertain",
    });
    expect(isArchiveBackupFailureReopenSafe(notStarted)).toBe(true);
    expect(isArchiveBackupFailureReopenSafe(released)).toBe(true);
    expect(isArchiveBackupFailureReopenSafe(uncertain)).toBe(false);
    expect(isArchiveBackupFailureReopenSafe(unresolvedPreHost)).toBe(false);
    expect(
      archiveBackupFreezeFailureResult({
        enabled: false,
        hostOperationStarted: false,
        error: undefined,
      }),
    ).toBeUndefined();
  });
});
