let btrfsMock: jest.Mock;
let sudoMock: jest.Mock;
let getGenerationMock: jest.Mock;
let existsMock: jest.Mock;
let fsReaddirMock: jest.Mock;

jest.mock("@cocalc/file-server/btrfs/util", () => ({
  btrfs: (...args: any[]) => btrfsMock(...args),
  sudo: (...args: any[]) => sudoMock(...args),
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

jest.mock("node:fs/promises", () => ({
  readdir: (...args: any[]) => fsReaddirMock(...args),
}));

import {
  assertFrozenVolumeMatchesBackup,
  deleteOrphanedStagedArchiveSnapshots,
  deleteStagedArchiveSnapshots,
  freezeVolumeForArchiveBackup,
  listStagedArchiveVolumeNames,
  releaseArchiveVolumeFreeze,
  releaseArchiveVolumeFreezeIfGenerationMatches,
} from "./archive-volume-barrier";

function volume(readdir: jest.Mock, del = jest.fn(async () => undefined)) {
  return {
    name: "project-1",
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
    sudoMock = jest.fn(async () => ({ stdout: "" }));
    getGenerationMock = jest.fn(async () => 42);
    existsMock = jest.fn(async (path: string) => path === "/mnt/project-1");
    fsReaddirMock = jest.fn(async () => {
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    });
  });

  it("lists staged archive volumes and tolerates a missing staging root", async () => {
    await expect(listStagedArchiveVolumeNames("/mnt")).resolves.toEqual([]);

    fsReaddirMock.mockResolvedValueOnce(["project-b", "project-a"]);
    await expect(listStagedArchiveVolumeNames("/mnt")).resolves.toEqual([
      "project-a",
      "project-b",
    ]);
    expect(fsReaddirMock).toHaveBeenLastCalledWith(
      "/mnt/.archive-snapshot-staging",
    );
  });

  it("stages local snapshots before freezing for the final backup", async () => {
    const del = jest.fn(async () => undefined);
    const vol = volume(
      jest.fn(async () => ["daily-1"]),
      del,
    );

    await expect(freezeVolumeForArchiveBackup(vol)).resolves.toEqual({
      alreadyReadonly: false,
    });
    expect(del).not.toHaveBeenCalled();
    expect(sudoMock).toHaveBeenCalledWith({
      command: "mv",
      args: [
        "/mnt/project-1/.snapshots/daily-1",
        "/mnt/.archive-snapshot-staging/project-1/daily-1",
      ],
    });
    expect(btrfsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["property", "set", "-ts", "/mnt/project-1", "ro", "true"],
      }),
    );
    const moveOrder = sudoMock.mock.invocationCallOrder.at(-1)!;
    const freezeOrder = btrfsMock.mock.invocationCallOrder.at(-1)!;
    expect(moveOrder).toBeLessThan(freezeOrder);
  });

  it("resumes an already frozen backup without moving snapshots again", async () => {
    btrfsMock.mockImplementation(async ({ args }) => {
      if (args?.[0] === "property" && args?.[1] === "get") {
        return { stdout: "ro=true\n" };
      }
      return { stdout: "" };
    });
    const del = jest.fn(async () => undefined);
    const vol = volume(
      jest.fn(async () => ["daily-1"]),
      del,
    );

    await expect(freezeVolumeForArchiveBackup(vol)).resolves.toEqual({
      alreadyReadonly: true,
    });
    expect(del).not.toHaveBeenCalled();
    expect(vol.snapshots.readdir).not.toHaveBeenCalled();
    expect(sudoMock).not.toHaveBeenCalled();
    expect(
      btrfsMock.mock.calls.some(
        ([{ args }]) => args?.[0] === "property" && args?.[1] === "set",
      ),
    ).toBe(false);
  });

  it("restores staged local snapshots when the archive is released", async () => {
    btrfsMock.mockImplementation(async ({ args }) => {
      if (args?.[0] === "property" && args?.[1] === "get") {
        return { stdout: "ro=true\n" };
      }
      return { stdout: "" };
    });
    fsReaddirMock.mockResolvedValueOnce(["daily-1"]);
    const vol = volume(jest.fn(async () => []));

    await expect(releaseArchiveVolumeFreeze(vol)).resolves.toBe("released");

    expect(sudoMock).toHaveBeenCalledWith({
      command: "mv",
      args: [
        "/mnt/.archive-snapshot-staging/project-1/daily-1",
        "/mnt/project-1/.snapshots/daily-1",
      ],
    });
    expect(btrfsMock).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(["false"]) }),
    );
    const unfreezeOrder = btrfsMock.mock.invocationCallOrder.at(-1)!;
    const restoreOrder = sudoMock.mock.invocationCallOrder.find(
      (_, index) => sudoMock.mock.calls[index][0].command === "mv",
    )!;
    expect(unfreezeOrder).toBeLessThan(restoreOrder);
  });

  it("deletes staged snapshots only after project deletion commits", async () => {
    fsReaddirMock.mockResolvedValueOnce(["daily-1"]);
    const vol = volume(jest.fn(async () => []));

    await deleteStagedArchiveSnapshots(vol);

    expect(btrfsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "subvolume",
          "delete",
          "/mnt/.archive-snapshot-staging/project-1/daily-1",
        ],
      }),
    );
    expect(sudoMock).toHaveBeenCalledWith({
      command: "rm",
      args: ["-rf", "/mnt/.archive-snapshot-staging/project-1"],
    });
  });

  it("does not ask the storage wrapper to remove missing staging", async () => {
    const vol = volume(jest.fn(async () => []));

    await expect(deleteStagedArchiveSnapshots(vol)).resolves.toBeUndefined();

    expect(sudoMock).not.toHaveBeenCalled();
  });

  it("removes an existing empty staging directory", async () => {
    const vol = volume(jest.fn(async () => []));
    existsMock.mockImplementation(
      async (path: string) =>
        path === "/mnt/project-1" ||
        path === "/mnt/.archive-snapshot-staging/project-1",
    );

    await deleteStagedArchiveSnapshots(vol);

    expect(sudoMock).toHaveBeenCalledWith({
      command: "rm",
      args: ["-rf", "/mnt/.archive-snapshot-staging/project-1"],
    });
  });

  it("deletes orphan staging only while the project parent is absent", async () => {
    const vol = volume(jest.fn(async () => []));
    await expect(deleteOrphanedStagedArchiveSnapshots(vol)).resolves.toBe(
      "retained",
    );
    expect(
      btrfsMock.mock.calls.some(
        ([{ args }]) => args?.[0] === "subvolume" && args?.[1] === "delete",
      ),
    ).toBe(false);

    existsMock.mockResolvedValueOnce(false);
    fsReaddirMock.mockResolvedValueOnce(["daily-1"]);
    await expect(deleteOrphanedStagedArchiveSnapshots(vol)).resolves.toBe(
      "deleted",
    );
    expect(btrfsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "subvolume",
          "delete",
          "/mnt/.archive-snapshot-staging/project-1/daily-1",
        ],
      }),
    );
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
    btrfsMock.mockImplementation(async ({ args }) => {
      if (args?.[0] === "property" && args?.[1] === "get") {
        return { stdout: "ro=true\n" };
      }
      return { stdout: "" };
    });
    await expect(
      releaseArchiveVolumeFreeze(volume(jest.fn(async () => []))),
    ).resolves.toBe("released");
    expect(btrfsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["property", "set", "-ts", "/mnt/project-1", "ro", "false"],
      }),
    );
    expect(sudoMock).not.toHaveBeenCalled();
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
