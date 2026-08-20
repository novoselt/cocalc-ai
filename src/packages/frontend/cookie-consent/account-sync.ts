/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

// Account writes merge over a snapshot of other_settings read when the write
// starts, so two consent writers racing on one consent event would silently
// drop each other's keys.  Everything the banner mirrors onto the account is
// therefore decided here and written exactly once.

import { COOKIE_CONSENT_REVISION } from "@cocalc/util/cookie-consent";
import {
  buildMarketingConsentUpdate,
  type MarketingEmailConsentSource,
} from "@cocalc/util/notification-preferences";

import { MARKETING_CONSENT_CATEGORY } from "./categories";
import type { ConsentSnapshot } from "./index";

export const ACCOUNT_COOKIE_CONSENT_KEY = "cookie_consent";

export interface ConsentAccountState {
  storedSnapshot?: { timestamp?: string; revision?: number } | null;
  marketingEnabled: boolean;
  hasMarketingRecord: boolean;
  notificationPreferences?: unknown;
}

// Identifies one consent decision, so the follow-up event that the banner
// emits for the same decision does not write a second time.
export function consentDecisionKey(snapshot: ConsentSnapshot | null): string {
  if (snapshot == null) return "";
  return `${snapshot.revision}:${snapshot.timestamp}:${!!snapshot[
    MARKETING_CONSENT_CATEGORY
  ]}`;
}

export function buildConsentAccountUpdate({
  account,
  marketingSource = "cookie-banner",
  recordedAt,
  snapshot,
}: {
  account: ConsentAccountState;
  marketingSource?: MarketingEmailConsentSource;
  recordedAt?: Date;
  snapshot: ConsentSnapshot | null;
}): Record<string, unknown> | null {
  if (snapshot == null) return null;
  const update: Record<string, unknown> = {};

  const stored = account.storedSnapshot;
  if (
    stored == null ||
    stored.timestamp !== snapshot.timestamp ||
    stored.revision !== snapshot.revision
  ) {
    update[ACCOUNT_COOKIE_CONSENT_KEY] = snapshot;
  }

  // Older snapshots predate the marketing category and say nothing about it.
  if (snapshot.revision === COOKIE_CONSENT_REVISION) {
    const enabled = !!snapshot[MARKETING_CONSENT_CATEGORY];
    if (enabled !== account.marketingEnabled || !account.hasMarketingRecord) {
      Object.assign(
        update,
        buildMarketingConsentUpdate({
          enabled,
          notificationPreferences: account.notificationPreferences,
          recordedAt,
          source: marketingSource,
        }),
      );
    }
  }

  return Object.keys(update).length === 0 ? null : update;
}
