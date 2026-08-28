/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { exists } from "@cocalc/backend/misc/async-utils-node";
import type { Subvolume } from "@cocalc/file-server/btrfs/subvolume";
import { getGeneration } from "@cocalc/file-server/btrfs/subvolume-snapshots";
import { btrfs } from "@cocalc/file-server/btrfs/util";
import { withBtrfsMutationLock } from "@cocalc/file-server/btrfs/operation-cache";

const MAX_FREEZE_ATTEMPTS = 3;

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

export async function setSubvolumeReadonly(
  path: string,
  readOnly: boolean,
  mount: string,
): Promise<void> {
  await withBtrfsMutationLock({
    mount,
    operation: readOnly ? "archive-volume-freeze" : "archive-volume-unfreeze",
    run: async () => {
      await btrfs({
        args: [
          "property",
          "set",
          "-ts",
          path,
          "ro",
          readOnly ? "true" : "false",
        ],
        err_on_exit: true,
        verbose: false,
      });
    },
  });
}

export interface ArchiveVolumeFreeze {
  alreadyReadonly: boolean;
}

/**
 * Remove local rolling snapshots, then make the live project volume read-only.
 * Rustic excludes these local snapshots, so removing them cannot remove data
 * from the recovery backup. Rechecking after the read-only transition closes
 * the race with scheduled snapshot maintenance.
 */
export async function freezeVolumeForArchiveBackup(
  volume: Subvolume,
): Promise<ArchiveVolumeFreeze> {
  if (await isSubvolumeReadonly(volume.path)) {
    const nested = await volume.snapshots.readdir();
    if (!nested.length) {
      return { alreadyReadonly: true };
    }
    // A host interruption can occur after the read-only transition but before
    // a raced local snapshot is removed. Resume the normal prune/freeze loop.
    await setSubvolumeReadonly(
      volume.path,
      false,
      volume.filesystem.opts.mount,
    );
  }

  for (let attempt = 1; attempt <= MAX_FREEZE_ATTEMPTS; attempt += 1) {
    for (const snapshot of await volume.snapshots.readdir()) {
      await volume.snapshots.delete(snapshot);
    }
    await setSubvolumeReadonly(volume.path, true, volume.filesystem.opts.mount);
    const nested = await volume.snapshots.readdir();
    if (!nested.length) {
      return { alreadyReadonly: false };
    }
    await setSubvolumeReadonly(
      volume.path,
      false,
      volume.filesystem.opts.mount,
    );
  }
  throw new Error(
    "unable to freeze project volume without nested local snapshots",
  );
}

export async function releaseArchiveVolumeFreeze(
  volume: Subvolume,
): Promise<void> {
  if (await exists(volume.path)) {
    await setSubvolumeReadonly(
      volume.path,
      false,
      volume.filesystem.opts.mount,
    );
  }
}

export async function releaseArchiveVolumeFreezeIfGenerationMatches({
  volume,
  expectedGeneration,
}: {
  volume: Subvolume;
  expectedGeneration: number;
}): Promise<"absent" | "already-writable" | "released"> {
  if (!(await exists(volume.path))) return "absent";
  if (!(await isSubvolumeReadonly(volume.path))) return "already-writable";
  const generation = await getGeneration(volume.path, { cache: false });
  if (generation !== expectedGeneration) {
    throw new Error(
      `refusing to release archive freeze at generation ${generation}; expected ${expectedGeneration}`,
    );
  }
  await setSubvolumeReadonly(volume.path, false, volume.filesystem.opts.mount);
  return "released";
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
      "archive-frozen project volume contains local snapshots and cannot be deleted safely",
    );
  }
  return generation;
}
