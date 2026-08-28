let btrfsMock: jest.Mock;
let getGenerationMock: jest.Mock;
let existsMock: jest.Mock;

jest.mock("@cocalc/file-server/btrfs/util", () => ({
  btrfs: (...args: any[]) => btrfsMock(...args),
}));

jest.mock("@cocalc/file-server/btrfs/subvolume-snapshots", () => ({
  getGeneration: (...args: any[]) => getGenerationMock(...args),
}));

jest.mock("@cocalc/file-server/btrfs/operation-cache", () => ({
  withBtrfsMutationLock: async ({ run }: { run: () => Promise<unknown> }) =>
    await run(),
}));

jest.mock("@cocalc/backend/misc/async-utils-node", () => ({
  exists: (...args: any[]) => existsMock(...args),
}));

import {
  assertFrozenVolumeMatchesBackup,
  freezeVolumeForArchiveBackup,
  releaseArchiveVolumeFreeze,
  releaseArchiveVolumeFreezeIfGenerationMatches,
} from "./archive-volume-barrier";

function volume(readdir: jest.Mock, del = jest.fn(async () => undefined)) {
  return {
    path: "/mnt/project-1",
    filesystem: { opts: { mount: "/mnt" } },
    snapshots: { readdir, delete: del },
  } as any;
}

describe("archive volume barrier", () => {
  beforeEach(() => {
    btrfsMock = jest.fn(async ({ args }) => {
      if (args?.slice(0, 4).join(" ") === "property get -ts /mnt/project-1") {
        return { stdout: "ro=false\n" };
      }
      return { stdout: "" };
    });
    getGenerationMock = jest.fn(async () => 42);
    existsMock = jest.fn(async () => true);
  });

  it("removes excluded local snapshots and freezes before returning", async () => {
    const del = jest.fn(async () => undefined);
    const vol = volume(
      jest.fn(async () => ["daily-1"]),
      del,
    );
    // The second listing occurs after the read-only transition.
    vol.snapshots.readdir
      .mockResolvedValueOnce(["daily-1"])
      .mockResolvedValueOnce([]);

    await expect(freezeVolumeForArchiveBackup(vol)).resolves.toEqual({
      alreadyReadonly: false,
    });
    expect(del).toHaveBeenCalledWith("daily-1");
    expect(btrfsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["property", "set", "-ts", "/mnt/project-1", "ro", "true"],
      }),
    );
  });

  it("retries if scheduled maintenance creates a snapshot during freezing", async () => {
    const del = jest.fn(async () => undefined);
    const vol = volume(
      jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(["raced"])
        .mockResolvedValueOnce(["raced"])
        .mockResolvedValueOnce([]),
      del,
    );

    await expect(freezeVolumeForArchiveBackup(vol)).resolves.toEqual({
      alreadyReadonly: false,
    });
    expect(del).toHaveBeenCalledWith("raced");
    const setValues = btrfsMock.mock.calls
      .map(([{ args }]) => args)
      .filter((args) => args?.[0] === "property" && args?.[1] === "set")
      .map((args) => args.at(-1));
    expect(setValues).toEqual(["true", "false", "true"]);
  });

  it("recovers an interrupted freeze that retained a nested snapshot", async () => {
    btrfsMock.mockImplementation(async ({ args }) => {
      if (args?.[0] === "property" && args?.[1] === "get") {
        return { stdout: "ro=true\n" };
      }
      return { stdout: "" };
    });
    const del = jest.fn(async () => undefined);
    const vol = volume(
      jest
        .fn()
        .mockResolvedValueOnce(["raced"])
        .mockResolvedValueOnce(["raced"])
        .mockResolvedValueOnce([]),
      del,
    );

    await expect(freezeVolumeForArchiveBackup(vol)).resolves.toEqual({
      alreadyReadonly: false,
    });
    expect(del).toHaveBeenCalledWith("raced");
    const setValues = btrfsMock.mock.calls
      .map(([{ args }]) => args)
      .filter((args) => args?.[0] === "property" && args?.[1] === "set")
      .map((args) => args.at(-1));
    expect(setValues).toEqual(["false", "true"]);
  });

  it("validates the frozen live generation immediately before deletion", async () => {
    btrfsMock.mockResolvedValue({ stdout: "ro=true\n" });
    const vol = volume(jest.fn(async () => []));

    await expect(
      assertFrozenVolumeMatchesBackup({
        volume: vol,
        expectedGeneration: 42,
      }),
    ).resolves.toBe("present");
    expect(getGenerationMock).toHaveBeenCalledWith("/mnt/project-1", {
      cache: false,
    });

    getGenerationMock.mockResolvedValueOnce(43);
    await expect(
      assertFrozenVolumeMatchesBackup({
        volume: vol,
        expectedGeneration: 42,
      }),
    ).rejects.toThrow("does not match frozen project volume generation 43");
  });

  it("unfreezes a retained volume after a failed archive operation", async () => {
    await releaseArchiveVolumeFreeze(volume(jest.fn(async () => [])));
    expect(btrfsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["property", "set", "-ts", "/mnt/project-1", "ro", "false"],
      }),
    );
  });

  it("only releases a persisted archive freeze at its recorded generation", async () => {
    btrfsMock.mockResolvedValue({ stdout: "ro=true\n" });
    const vol = volume(jest.fn(async () => []));

    await expect(
      releaseArchiveVolumeFreezeIfGenerationMatches({
        volume: vol,
        expectedGeneration: 42,
      }),
    ).resolves.toBe("released");
    expect(btrfsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(["false"]) }),
    );

    getGenerationMock.mockResolvedValueOnce(43);
    await expect(
      releaseArchiveVolumeFreezeIfGenerationMatches({
        volume: vol,
        expectedGeneration: 42,
      }),
    ).rejects.toThrow("expected 42");
  });

  it("reports idempotent rollback states without changing data", async () => {
    const vol = volume(jest.fn(async () => []));
    existsMock.mockResolvedValueOnce(false);
    await expect(
      releaseArchiveVolumeFreezeIfGenerationMatches({
        volume: vol,
        expectedGeneration: 42,
      }),
    ).resolves.toBe("absent");

    btrfsMock.mockResolvedValueOnce({ stdout: "ro=false\n" });
    await expect(
      releaseArchiveVolumeFreezeIfGenerationMatches({
        volume: vol,
        expectedGeneration: 42,
      }),
    ).resolves.toBe("already-writable");
    expect(getGenerationMock).not.toHaveBeenCalled();
  });
});
