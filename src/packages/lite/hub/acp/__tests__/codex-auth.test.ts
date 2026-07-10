import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const spawnMock = jest.fn();

jest.mock("@cocalc/backend/logger", () => ({
  __esModule: true,
  default: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock("node:child_process", () => ({
  spawn: (...args: any[]) => spawnMock(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = jest.fn();
}

describe("lite codex device auth", () => {
  let codexHome: string;

  beforeEach(async () => {
    jest.resetModules();
    spawnMock.mockReset();
    codexHome = await mkdtemp(join(tmpdir(), "cocalc-lite-codex-auth-"));
    process.env.COCALC_CODEX_HOME = codexHome;
  });

  afterEach(async () => {
    delete process.env.COCALC_CODEX_HOME;
    await rm(codexHome, { force: true, recursive: true });
  });

  it("does not report completed until local auth is verified", async () => {
    const verification = deferred<void>();
    const proc = new FakeProc();
    spawnMock.mockReturnValue(proc);
    const {
      startLiteCodexDeviceAuth,
      getLiteCodexDeviceAuthStatus,
      verifyLiteCodexDeviceAuthStatus,
    } = await import("../../codex-auth");

    const started = await startLiteCodexDeviceAuth({
      projectId: "project-1",
      accountId: "account-1",
    });
    proc.emit("exit", 0, null);

    expect(getLiteCodexDeviceAuthStatus(started.id)).toMatchObject({
      state: "syncing",
      syncedToRegistry: undefined,
    });

    const verifying = verifyLiteCodexDeviceAuthStatus(
      started.id,
      () => verification.promise,
    );
    await Promise.resolve();

    expect(getLiteCodexDeviceAuthStatus(started.id)).toMatchObject({
      state: "syncing",
    });

    verification.resolve();
    await verifying;

    expect(getLiteCodexDeviceAuthStatus(started.id)).toMatchObject({
      state: "completed",
      syncedToRegistry: true,
    });
  });

  it("shares one local auth verification across concurrent status polls", async () => {
    const verification = deferred<void>();
    const proc = new FakeProc();
    const verifier = jest.fn(() => verification.promise);
    spawnMock.mockReturnValue(proc);
    const {
      startLiteCodexDeviceAuth,
      getLiteCodexDeviceAuthStatus,
      verifyLiteCodexDeviceAuthStatus,
    } = await import("../../codex-auth");

    const started = await startLiteCodexDeviceAuth({
      projectId: "project-1",
      accountId: "account-1",
    });
    proc.emit("exit", 0, null);

    const first = verifyLiteCodexDeviceAuthStatus(started.id, verifier);
    const second = verifyLiteCodexDeviceAuthStatus(started.id, verifier);
    await Promise.resolve();

    expect(verifier).toHaveBeenCalledTimes(1);
    expect(getLiteCodexDeviceAuthStatus(started.id)).toMatchObject({
      state: "syncing",
    });

    verification.resolve();
    await Promise.all([first, second]);

    expect(getLiteCodexDeviceAuthStatus(started.id)).toMatchObject({
      state: "completed",
      syncedToRegistry: true,
    });
  });

  it("fails device auth when local auth cannot be verified", async () => {
    const proc = new FakeProc();
    spawnMock.mockReturnValue(proc);
    const { startLiteCodexDeviceAuth, verifyLiteCodexDeviceAuthStatus } =
      await import("../../codex-auth");

    const started = await startLiteCodexDeviceAuth({
      projectId: "project-1",
      accountId: "account-1",
    });
    proc.emit("exit", 0, null);

    const status = await verifyLiteCodexDeviceAuthStatus(
      started.id,
      async () => {
        throw Error("account/rateLimits/read: auth required");
      },
    );

    expect(status).toMatchObject({
      state: "failed",
      syncedToRegistry: false,
      syncError: "Error: account/rateLimits/read: auth required",
      error:
        "ChatGPT sign-in succeeded, but CoCalc could not verify that Codex can use the saved credential. Please try signing in again.",
    });
  });
});
