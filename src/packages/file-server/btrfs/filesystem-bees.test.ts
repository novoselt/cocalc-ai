import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import bees from "./bees";
import { Filesystem } from "./filesystem";

jest.mock("./bees", () => ({
  __esModule: true,
  BEES_ALREADY_RUNNING_EXIT_CODE: 75,
  default: jest.fn(),
  signalBeesProcessGroup: jest.fn(),
}));

const mockedBees = jest.mocked(bees);

function childProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid: 1234,
    killed: false,
    exitCode: null,
  });
  return child;
}

describe("BEES process supervision", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedBees.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("acquires BEES after an inherited process exits during rollout", async () => {
    const child = childProcess();
    mockedBees
      .mockResolvedValueOnce({
        status: "already-running",
        detail: "BEES_ALREADY_RUNNING pid=99",
      })
      .mockResolvedValueOnce({ status: "started", child });

    const filesystem = new Filesystem({
      mount: "/mnt/cocalc",
      rustic: "/tmp/rustic.toml",
    });
    await (filesystem as any).startBees("startup");

    expect(filesystem.getBeesStatus()).toMatchObject({
      running: true,
      external: true,
      restartAttempts: 1,
      restartPending: true,
    });

    await jest.advanceTimersByTimeAsync(1_000);

    expect(mockedBees).toHaveBeenCalledTimes(2);
    expect(filesystem.getBeesStatus()).toMatchObject({
      running: true,
      external: false,
      pid: 1234,
      restartAttempts: 0,
      restartPending: false,
    });

    filesystem.close();
  });

  it("treats a late wrapper ownership refusal as a handoff", async () => {
    const refused = childProcess();
    const replacement = childProcess();
    Object.assign(replacement, { pid: 5678 });
    mockedBees
      .mockResolvedValueOnce({ status: "started", child: refused })
      .mockResolvedValueOnce({ status: "started", child: replacement });

    const filesystem = new Filesystem({
      mount: "/mnt/cocalc",
      rustic: "/tmp/rustic.toml",
    });
    await (filesystem as any).startBees("startup");
    refused.emit("exit", 75, null);

    expect(filesystem.getBeesStatus()).toMatchObject({
      running: true,
      external: true,
      restartPending: true,
    });

    await jest.advanceTimersByTimeAsync(1_000);
    expect(filesystem.getBeesStatus()).toMatchObject({
      running: true,
      external: false,
      pid: 5678,
      restartPending: false,
    });

    filesystem.close();
  });
});
