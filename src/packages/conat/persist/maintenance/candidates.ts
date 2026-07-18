/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type {
  PersistMaintenanceCandidate,
  PersistMaintenanceCandidateDecision,
  PersistMaintenanceCandidatePolicy,
} from "./types";

export function evaluatePersistMaintenanceCandidate(
  candidate: PersistMaintenanceCandidate,
  policy: PersistMaintenanceCandidatePolicy,
): PersistMaintenanceCandidateDecision {
  if (candidate.openOwners > 0) {
    return { eligible: false, reason: "open" };
  }
  if (
    candidate.lastActivityAt != null &&
    policy.now - candidate.lastActivityAt < policy.idleMs
  ) {
    return { eligible: false, reason: "active" };
  }
  if (
    candidate.lastCompactedAt != null &&
    policy.now - candidate.lastCompactedAt < policy.minBetweenMs
  ) {
    return { eligible: false, reason: "recently-compacted" };
  }
  if (candidate.retryAfter != null && candidate.retryAfter > policy.now) {
    return { eligible: false, reason: "retry-cooldown" };
  }
  if (candidate.fileSizeBytes < policy.minFileBytes) {
    return { eligible: false, reason: "too-small" };
  }
  if (candidate.fileSizeBytes > policy.maxFileBytes) {
    return { eligible: false, reason: "too-large" };
  }
  if (candidate.reclaimableBytes < policy.minReclaimBytes) {
    return { eligible: false, reason: "insufficient-reclaim-bytes" };
  }
  if (candidate.reclaimableRatio < policy.minReclaimRatio) {
    return { eligible: false, reason: "insufficient-reclaim-ratio" };
  }
  return { eligible: true };
}
