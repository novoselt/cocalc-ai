/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export type BackupRetentionCandidate = {
  id: string;
  time: Date;
};

export function planBackupRetention({
  backups,
  limit,
  replaceOldestAtLimit,
}: {
  backups: BackupRetentionCandidate[];
  limit?: number;
  replaceOldestAtLimit?: boolean;
}): {
  allowed: boolean;
  replace: BackupRetentionCandidate[];
} {
  if (limit == null) {
    return { allowed: true, replace: [] };
  }
  const normalizedLimit = Math.max(0, Math.floor(limit));
  if (!replaceOldestAtLimit) {
    return {
      allowed: normalizedLimit > 0 && backups.length < normalizedLimit,
      replace: [],
    };
  }

  // A final archival backup must remain recoverable even when the current
  // membership technically permits no backups. Create the replacement first,
  // then prune only snapshots that existed before it.
  const retainedLimit = Math.max(1, normalizedLimit);
  const replaceCount = Math.max(0, backups.length + 1 - retainedLimit);
  const oldestFirst = [...backups].sort(
    (a, b) => a.time.getTime() - b.time.getTime(),
  );
  return {
    allowed: true,
    replace: oldestFirst.slice(0, replaceCount),
  };
}
