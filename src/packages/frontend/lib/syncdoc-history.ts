/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

interface SyncDocHistory {
  isReady: () => boolean;
}

// SyncDoc readiness is local lifecycle state, independent of network state.
export function canUseSyncDocHistory(
  syncdoc: SyncDocHistory | null | undefined,
): boolean {
  return syncdoc?.isReady?.() === true;
}
