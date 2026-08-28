/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { exists } from "@cocalc/backend/misc/async-utils-node";
import type { Subvolume } from "@cocalc/file-server/btrfs/subvolume";
import { getGeneration } from "@cocalc/file-server/btrfs/subvolume-snapshots";
import { btrfs, sudo } from "@cocalc/file-server/btrfs/util";
import { withBtrfsMutationLock } from "@cocalc/file-server/btrfs/operation-cache";
import { SNAPSHOTS } from "@cocalc/util/consts/snapshots";
import { assertValidSnapshotName } from "@cocalc/util/snapshot-name";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const ARCHIVE_SNAPSHOT_STAGING_DIR = ".archive-snapshot-staging";

function snapshotStagingRoot(volume: Subvolume): string {
  return join(
    volume.filesystem.opts.mount,
    ARCHIVE_SNAPSHOT_STAGING_DIR,
    volume.name,
  );
}

export async function listStagedArchiveVolumeNames(
  mount: string,
): Promise<string[]> {
  try {
    return (await readdir(join(mount, ARCHIVE_SNAPSHOT_STAGING_DIR))).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
}

async function stagedSnapshotNames(volume: Subvolume): Promise<string[]> {
  try {
    return (await readdir(snapshotStagingRoot(volume)))
      .map((name) => assertValidSnapshotName(name))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
}

export async function isSubvolumeReadonly(path: string): Promise<boolean> {
  const { stdout } = await btrfs({
    args: ["property", "get", "-ts", path, "ro"],
    err_on_exit: true,
    verbose: false,
  });
  const match = `${stdout}`.match(/\bro\s*=\s*(true|false)\b/i);
  if (!match) {
    throw new Error(
      `unable to determine whether subvolume is read-only: ${path}`,
    );
  }
  return match[1].toLowerCase() === "true";
}

async function setSubvolumeReadonlyUnlocked(
  path: string,
  readOnly: boolean,
): Promise<void> {
  await btrfs({
    args: ["property", "set", "-ts", path, "ro", readOnly ? "true" : "false"],
    err_on_exit: true,
    verbose: false,
  });
}

export async function setSubvolumeReadonly(
  path: string,
  readOnly: boolean,
  mount: string,
): Promise<void> {
  await withBtrfsMutationLock({
    mount,
    operation: readOnly ? "archive-volume-freeze" : "archive-volume-unfreeze",
    run: async () => await setSubvolumeReadonlyUnlocked(path, readOnly),
  });
}

async function stageLocalSnapshotsUnlocked(volume: Subvolume): Promise<void> {
  const names = await volume.snapshots.readdir();
  if (!names.length) return;
  const root = snapshotStagingRoot(volume);
  await sudo({ command: "mkdir", args: ["-p", root] });
  for (const name of names) {
    const safeName = assertValidSnapshotName(name);
    const source = join(volume.path, SNAPSHOTS, safeName);
    const destination = join(root, safeName);
    if (await exists(destination)) {
      throw new Error(`archive snapshot staging collision: ${safeName}`);
    }
    await sudo({ command: "mv", args: [source, destination] });
  }
}

async function restoreLocalSnapshotsUnlocked(volume: Subvolume): Promise<void> {
  const names = await stagedSnapshotNames(volume);
  if (names.length) {
    const snapshotsRoot = join(volume.path, SNAPSHOTS);
    await sudo({ command: "mkdir", args: ["-p", snapshotsRoot] });
    for (const name of names) {
      const source = join(snapshotStagingRoot(volume), name);
      const destination = join(snapshotsRoot, name);
      if (await exists(destination)) {
        throw new Error(`archive snapshot restore collision: ${name}`);
      }
      await sudo({ command: "mv", args: [source, destination] });
    }
  }
  await sudo({
    command: "rm",
    args: ["-rf", snapshotStagingRoot(volume)],
  });
}

async function deleteStagedArchiveSnapshotsUnlocked(
  volume: Subvolume,
): Promise<void> {
  const names = await stagedSnapshotNames(volume);
  for (const name of names) {
    await btrfs({
      args: ["subvolume", "delete", join(snapshotStagingRoot(volume), name)],
      err_on_exit: true,
      verbose: false,
    });
  }
  await sudo({
    command: "rm",
    args: ["-rf", snapshotStagingRoot(volume)],
  });
}

export async function deleteStagedArchiveSnapshots(
  volume: Subvolume,
): Promise<void> {
  await withBtrfsMutationLock({
    mount: volume.filesystem.opts.mount,
    operation: "archive-staged-snapshot-delete",
    run: async () => await deleteStagedArchiveSnapshotsUnlocked(volume),
  });
}

export interface ArchiveVolumeFreeze {
  alreadyReadonly: boolean;
}

/**
 * Move local recovery snapshots out of the project subvolume, then freeze the
 * live source in the same Btrfs mutation critical section. The move is cheap
 * and reversible; Rustic excludes these snapshots, but every abort path moves
 * them back before making the project usable again.
 */
export async function freezeVolumeForArchiveBackup(
  volume: Subvolume,
): Promise<ArchiveVolumeFreeze> {
  let alreadyReadonly = false;
  await withBtrfsMutationLock({
    mount: volume.filesystem.opts.mount,
    operation: "archive-volume-freeze",
    run: async () => {
      if (await isSubvolumeReadonly(volume.path)) {
        alreadyReadonly = true;
        return;
      }
      await stageLocalSnapshotsUnlocked(volume);
      await setSubvolumeReadonlyUnlocked(volume.path, true);
    },
  });
  return { alreadyReadonly };
}

export async function releaseArchiveVolumeFreeze(
  volume: Subvolume,
): Promise<"absent" | "already-writable" | "released"> {
  return await withBtrfsMutationLock({
    mount: volume.filesystem.opts.mount,
    operation: "archive-volume-unfreeze",
    run: async () => {
      if (!(await exists(volume.path))) {
        await deleteStagedArchiveSnapshotsUnlocked(volume);
        return "absent" as const;
      }
      if (await isSubvolumeReadonly(volume.path)) {
        await setSubvolumeReadonlyUnlocked(volume.path, false);
        await restoreLocalSnapshotsUnlocked(volume);
        return "released" as const;
      }
      await restoreLocalSnapshotsUnlocked(volume);
      return "already-writable" as const;
    },
  });
}

export async function releaseArchiveVolumeFreezeIfGenerationMatches({
  volume,
  expectedGeneration,
}: {
  volume: Subvolume;
  expectedGeneration: number;
}): Promise<"absent" | "already-writable" | "released"> {
  return await withBtrfsMutationLock({
    mount: volume.filesystem.opts.mount,
    operation: "archive-volume-unfreeze",
    run: async () => {
      if (!(await exists(volume.path))) {
        await deleteStagedArchiveSnapshotsUnlocked(volume);
        return "absent";
      }
      if (!(await isSubvolumeReadonly(volume.path))) {
        await restoreLocalSnapshotsUnlocked(volume);
        return "already-writable";
      }
      const generation = await getGeneration(volume.path, { cache: false });
      if (generation !== expectedGeneration) {
        throw new Error(
          `refusing to release archive freeze at generation ${generation}; expected ${expectedGeneration}`,
        );
      }
      await setSubvolumeReadonlyUnlocked(volume.path, false);
      await restoreLocalSnapshotsUnlocked(volume);
      return "released";
    },
  });
}

export async function assertFrozenVolumeMatchesBackup({
  volume,
  expectedGeneration,
}: {
  volume: Subvolume;
  expectedGeneration: number;
}): Promise<"present" | "absent"> {
  if (!(await exists(volume.path))) return "absent";
  const generation = await getFrozenVolumeGeneration(volume);
  if (generation !== expectedGeneration) {
    throw new Error(
      `archive backup generation ${expectedGeneration} does not match frozen project volume generation ${generation}`,
    );
  }
  return "present";
}

export async function getFrozenVolumeGeneration(
  volume: Subvolume,
): Promise<number> {
  if (!(await isSubvolumeReadonly(volume.path))) {
    throw new Error("project volume is not frozen for archive deletion");
  }
  const generation = await getGeneration(volume.path, { cache: false });
  const nested = await volume.snapshots.readdir();
  if (nested.length) {
    throw new Error(
      "archive-frozen project volume contains unstaged local snapshots",
    );
  }
  return generation;
}
