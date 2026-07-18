/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export type PersistMaintenanceScopeType =
  | "project"
  | "account"
  | "host"
  | "hub"
  | "other";

export interface PersistMaintenancePath {
  logicalPath: string;
  physicalPath: string;
  archivePath?: string;
  backupPath?: string;
  scopeType: PersistMaintenanceScopeType;
  scopeId?: string;
}

export interface PersistMaintenanceOwner {
  ownerId: string;
  pid: number;
  processStartToken: string;
  workerId: string;
}

export interface PersistMaintenanceUse
  extends PersistMaintenancePath, PersistMaintenanceOwner {}

export interface PersistMaintenanceClose extends PersistMaintenanceUse {
  dirty: boolean;
}

export interface PersistMaintenanceHandle {
  ownerId: string;
  onFinalClose: (dirty: boolean) => void;
  onMutation: () => void;
}

/**
 * Optional lifecycle integration for persist. Implementations must fail open
 * for stream service, but must fail closed for maintenance promotion.
 */
export interface PersistMaintenanceHooks {
  beginOpen: (
    path: PersistMaintenancePath,
  ) => Promise<PersistMaintenanceHandle | undefined>;
  openFailed?: (path: PersistMaintenancePath, error: unknown) => void;
  trackingUnavailable?: (error: unknown) => void;
}

export interface PersistMaintenanceFileIdentity {
  device: number;
  inode: number;
  sizeBytes: number;
  mtimeMs: number;
  walSizeBytes: number;
}

export interface PersistMaintenancePageStats {
  pageSize: number;
  pageCount: number;
  freelistCount: number;
  reclaimableBytes: number;
  quickCheck: string;
}

export interface PersistMaintenanceCandidate {
  physicalPath: string;
  fileSizeBytes: number;
  reclaimableBytes: number;
  reclaimableRatio: number;
  lastActivityAt?: number;
  lastCompactedAt?: number;
  retryAfter?: number;
  openOwners: number;
}

export interface PersistMaintenanceCandidatePolicy {
  now: number;
  idleMs: number;
  minFileBytes: number;
  minReclaimBytes: number;
  minReclaimRatio: number;
  minBetweenMs: number;
  maxFileBytes: number;
}

export type PersistMaintenanceCandidateDecision =
  | { eligible: true }
  | {
      eligible: false;
      reason:
        | "open"
        | "active"
        | "recently-compacted"
        | "retry-cooldown"
        | "too-small"
        | "too-large"
        | "insufficient-reclaim-bytes"
        | "insufficient-reclaim-ratio";
    };

export interface PersistMaintenanceStatus {
  enabled: boolean;
  dryRun: boolean;
  catalogHealthy: boolean;
  catalogPath: string;
  expectedWorkers: string[];
  registeredWorkers: string[];
  trackingCoverage: boolean;
  openPaths: number;
  presentDatabases: number;
  missingDatabases: number;
  unverifiedDatabases: number;
  eligibleCandidates: number;
  estimatedReclaimableBytes: number;
  scanRoots: string[];
  lastScanStartedAt?: number;
  lastScanCompletedAt?: number;
  scannedFiles: number;
  activeRun?: {
    runId: string;
    physicalPath: string;
    phase: string;
    startedAt: number;
    sourceSizeBytes: number;
  };
  attempts: number;
  successes: number;
  invalidations: number;
  timeouts: number;
  failures: number;
  inspectedBytes: number;
  reclaimedBytes: number;
  secondaryRefreshBacklog: number;
  pauseReason?: string;
  lastError?: string;
}
