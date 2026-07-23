import { callFilesystemClientWithRecovery } from "./project/redux/filesystem-client";

describe("ProjectActions.fs recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("recreates the filesystem client after a closed-method error", async () => {
    const deadStat = jest.fn().mockRejectedValue(new Error("closed"));
    const liveStat = jest.fn().mockResolvedValue({ size: 7 });
    const getClient = jest
      .fn()
      .mockResolvedValueOnce({ stat: deadStat })
      .mockResolvedValueOnce({ stat: liveStat });
    const clearClient = jest.fn();

    await expect(
      callFilesystemClientWithRecovery({
        getClient,
        clearClient,
        prop: "stat",
        args: ["/tmp/x"],
      }),
    ).resolves.toEqual({ size: 7 });
    expect(getClient).toHaveBeenCalledTimes(2);
    expect(clearClient).toHaveBeenCalledTimes(1);
    expect(deadStat).toHaveBeenCalledWith("/tmp/x");
    expect(liveStat).toHaveBeenCalledWith("/tmp/x");
  });

  it("recreates the filesystem client after a closed acquisition error", async () => {
    const liveStat = jest.fn().mockResolvedValue({ size: 11 });
    const getClient = jest
      .fn()
      .mockRejectedValueOnce(new Error("closed"))
      .mockResolvedValueOnce({ stat: liveStat });
    const clearClient = jest.fn();

    await expect(
      callFilesystemClientWithRecovery({
        getClient,
        clearClient,
        prop: "stat",
        args: ["/tmp/y"],
      }),
    ).resolves.toEqual({ size: 11 });
    expect(getClient).toHaveBeenCalledTimes(2);
    expect(clearClient).toHaveBeenCalledTimes(1);
    expect(liveStat).toHaveBeenCalledWith("/tmp/y");
  });

  it("does not retry permanent errors", async () => {
    const stat = jest.fn().mockRejectedValue(new Error("permission denied"));
    const getClient = jest.fn().mockResolvedValue({ stat });
    const clearClient = jest.fn();

    await expect(
      callFilesystemClientWithRecovery({
        getClient,
        clearClient,
        prop: "stat",
        args: ["/tmp/z"],
      }),
    ).rejects.toThrow("permission denied");
    expect(getClient).toHaveBeenCalledTimes(1);
    expect(clearClient).not.toHaveBeenCalled();
    expect(stat).toHaveBeenCalledTimes(1);
  });

  it("waits for a filesystem server that is still initializing", async () => {
    const startingStat = jest
      .fn()
      .mockRejectedValue(new Error("file server not initialized"));
    const liveStat = jest.fn().mockResolvedValue({ size: 13 });
    const getClient = jest
      .fn()
      .mockResolvedValueOnce({ stat: startingStat })
      .mockResolvedValueOnce({ stat: startingStat })
      .mockResolvedValueOnce({ stat: liveStat });
    const clearClient = jest.fn();
    const wait = jest.fn(async () => {});

    await expect(
      callFilesystemClientWithRecovery({
        getClient,
        clearClient,
        prop: "stat",
        args: ["/tmp/starting"],
        wait,
      }),
    ).resolves.toEqual({ size: 13 });
    expect(wait).toHaveBeenNthCalledWith(1, 100);
    expect(wait).toHaveBeenNthCalledWith(2, 250);
    expect(clearClient).toHaveBeenCalledTimes(2);
    expect(getClient).toHaveBeenCalledTimes(3);
  });
});
