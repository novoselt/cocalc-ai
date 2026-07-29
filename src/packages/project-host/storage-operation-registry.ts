/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export type StorageOperationPriority =
  | "lifecycle"
  | "interactive"
  | "scheduled"
  | "scavenger";

export type StorageOperationAttribution =
  | "project"
  | "maintenance"
  | "source-and-destination-project";

export type StorageOperationRecovery =
  | "inline-bounded"
  | "retryable"
  | "durable-checkpointed"
  | "indivisible-btrfs";

export type StorageOperationKind =
  | "project_volume_prepare"
  | "project_stop_finalize"
  | "interactive_snapshot"
  | "scheduled_snapshot"
  | "interactive_backup"
  | "scheduled_backup"
  | "project_restore"
  | "project_move"
  | "recursive_project_delete"
  | "project_archive"
  | "project_disk_scan"
  | "rootfs_project_work"
  | "rootfs_cache_maintenance"
  | "orphan_cleanup";

export interface StorageOperationSpec {
  kind: StorageOperationKind;
  attribution: StorageOperationAttribution;
  priority: StorageOperationPriority;
  recovery: StorageOperationRecovery;
  destructive: boolean;
  btrfs_mutation: boolean;
  checkpointable: boolean;
  initial_max_per_host?: number;
  initial_max_per_project?: number;
}

export const STORAGE_OPERATION_REGISTRY: Readonly<
  Record<StorageOperationKind, StorageOperationSpec>
> = {
  project_volume_prepare: {
    kind: "project_volume_prepare",
    attribution: "project",
    priority: "lifecycle",
    recovery: "retryable",
    destructive: false,
    btrfs_mutation: true,
    checkpointable: false,
  },
  project_stop_finalize: {
    kind: "project_stop_finalize",
    attribution: "project",
    priority: "lifecycle",
    recovery: "retryable",
    destructive: false,
    btrfs_mutation: false,
    checkpointable: false,
  },
  interactive_snapshot: {
    kind: "interactive_snapshot",
    attribution: "project",
    priority: "interactive",
    recovery: "indivisible-btrfs",
    destructive: true,
    btrfs_mutation: true,
    checkpointable: false,
    initial_max_per_host: 1,
    initial_max_per_project: 1,
  },
  scheduled_snapshot: {
    kind: "scheduled_snapshot",
    attribution: "project",
    priority: "scheduled",
    recovery: "indivisible-btrfs",
    destructive: true,
    btrfs_mutation: true,
    checkpointable: true,
    initial_max_per_host: 1,
    initial_max_per_project: 1,
  },
  interactive_backup: {
    kind: "interactive_backup",
    attribution: "project",
    priority: "interactive",
    recovery: "durable-checkpointed",
    destructive: false,
    btrfs_mutation: true,
    checkpointable: true,
    initial_max_per_project: 1,
  },
  scheduled_backup: {
    kind: "scheduled_backup",
    attribution: "project",
    priority: "scheduled",
    recovery: "durable-checkpointed",
    destructive: false,
    btrfs_mutation: true,
    checkpointable: true,
    initial_max_per_project: 1,
  },
  project_restore: {
    kind: "project_restore",
    attribution: "project",
    priority: "interactive",
    recovery: "durable-checkpointed",
    destructive: true,
    btrfs_mutation: true,
    checkpointable: true,
    initial_max_per_host: 1,
    initial_max_per_project: 1,
  },
  project_move: {
    kind: "project_move",
    attribution: "source-and-destination-project",
    priority: "lifecycle",
    recovery: "durable-checkpointed",
    destructive: false,
    btrfs_mutation: true,
    checkpointable: true,
  },
  recursive_project_delete: {
    kind: "recursive_project_delete",
    attribution: "project",
    priority: "interactive",
    recovery: "durable-checkpointed",
    destructive: true,
    btrfs_mutation: true,
    checkpointable: true,
    initial_max_per_project: 1,
  },
  project_archive: {
    kind: "project_archive",
    attribution: "project",
    priority: "interactive",
    recovery: "durable-checkpointed",
    destructive: false,
    btrfs_mutation: false,
    checkpointable: true,
    initial_max_per_project: 1,
  },
  project_disk_scan: {
    kind: "project_disk_scan",
    attribution: "project",
    priority: "interactive",
    recovery: "retryable",
    destructive: false,
    btrfs_mutation: false,
    checkpointable: true,
    initial_max_per_project: 1,
  },
  rootfs_project_work: {
    kind: "rootfs_project_work",
    attribution: "project",
    priority: "interactive",
    recovery: "durable-checkpointed",
    destructive: false,
    btrfs_mutation: false,
    checkpointable: true,
    initial_max_per_project: 1,
  },
  rootfs_cache_maintenance: {
    kind: "rootfs_cache_maintenance",
    attribution: "maintenance",
    priority: "scavenger",
    recovery: "retryable",
    destructive: true,
    btrfs_mutation: false,
    checkpointable: true,
    initial_max_per_host: 1,
  },
  orphan_cleanup: {
    kind: "orphan_cleanup",
    attribution: "maintenance",
    priority: "scavenger",
    recovery: "retryable",
    destructive: true,
    btrfs_mutation: true,
    checkpointable: true,
    initial_max_per_host: 1,
  },
};

export function getStorageOperationSpec(
  kind: StorageOperationKind,
): StorageOperationSpec {
  return STORAGE_OPERATION_REGISTRY[kind];
}
