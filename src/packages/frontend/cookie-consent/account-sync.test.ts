/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { COOKIE_CONSENT_REVISION } from "@cocalc/util/cookie-consent";
import {
  MARKETING_CONSENT_OTHER_SETTINGS_KEY,
  MARKETING_EMAIL_CONSENT_RECORD_OTHER_SETTINGS_KEY,
  OTHER_SETTINGS_NOTIFICATION_PREFERENCES_KEY,
} from "@cocalc/util/notification-preferences";

import {
  ACCOUNT_COOKIE_CONSENT_KEY,
  buildConsentAccountUpdate,
  consentDecisionKey,
} from "./account-sync";
import type { ConsentSnapshot } from "./index";

function snapshot(overrides: Partial<ConsentSnapshot> = {}): ConsentSnapshot {
  return {
    analytics: true,
    marketing: true,
    necessary: true,
    revision: COOKIE_CONSENT_REVISION,
    timestamp: "2026-08-19T09:24:51.821Z",
    usage: true,
    ...overrides,
  } as ConsentSnapshot;
}

const SUBSCRIBED = {
  hasMarketingRecord: true,
  marketingEnabled: true,
  storedSnapshot: { revision: COOKIE_CONSENT_REVISION, timestamp: "old" },
};

describe("consent account sync", () => {
  it("turns marketing off and on through the same decision", () => {
    const off = buildConsentAccountUpdate({
      account: SUBSCRIBED,
      snapshot: snapshot({ marketing: false }),
    });
    expect(off?.[MARKETING_CONSENT_OTHER_SETTINGS_KEY]).toBe(false);
    expect(off?.[ACCOUNT_COOKIE_CONSENT_KEY]).toMatchObject({
      marketing: false,
    });

    const on = buildConsentAccountUpdate({
      account: { ...SUBSCRIBED, marketingEnabled: false },
      snapshot: snapshot({ marketing: true }),
    });
    expect(on?.[MARKETING_CONSENT_OTHER_SETTINGS_KEY]).toBe(true);
  });

  it("writes the snapshot and the marketing keys in one update", () => {
    const update = buildConsentAccountUpdate({
      account: { ...SUBSCRIBED, notificationPreferences: { email: {} } },
      snapshot: snapshot({ marketing: false }),
    });

    // Account writes merge over a snapshot taken when the write starts, so
    // splitting these across two writes loses whichever lands first.
    expect(Object.keys(update ?? {}).sort()).toEqual(
      [
        ACCOUNT_COOKIE_CONSENT_KEY,
        MARKETING_CONSENT_OTHER_SETTINGS_KEY,
        MARKETING_EMAIL_CONSENT_RECORD_OTHER_SETTINGS_KEY,
        OTHER_SETTINGS_NOTIFICATION_PREFERENCES_KEY,
      ].sort(),
    );
  });

  it("does nothing when the account already agrees with the banner", () => {
    expect(
      buildConsentAccountUpdate({
        account: {
          ...SUBSCRIBED,
          storedSnapshot: {
            revision: COOKIE_CONSENT_REVISION,
            timestamp: snapshot().timestamp,
          },
        },
        snapshot: snapshot(),
      }),
    ).toBeNull();
  });

  it("records a first decision even when the value already matches", () => {
    const update = buildConsentAccountUpdate({
      account: { ...SUBSCRIBED, hasMarketingRecord: false },
      snapshot: snapshot(),
    });
    expect(
      update?.[MARKETING_EMAIL_CONSENT_RECORD_OTHER_SETTINGS_KEY],
    ).toMatchObject({ enabled: true, source: "cookie-banner" });
  });

  it("keeps the origin of a decision made in account settings", () => {
    const update = buildConsentAccountUpdate({
      account: SUBSCRIBED,
      marketingSource: "communication-settings",
      snapshot: snapshot({ marketing: false }),
    });
    expect(
      update?.[MARKETING_EMAIL_CONSENT_RECORD_OTHER_SETTINGS_KEY],
    ).toMatchObject({ source: "communication-settings" });
  });

  it("leaves marketing alone for a snapshot from an older revision", () => {
    const update = buildConsentAccountUpdate({
      account: SUBSCRIBED,
      snapshot: snapshot({ marketing: false, revision: 2 }),
    });
    expect(update).not.toBeNull();
    expect(update).not.toHaveProperty(MARKETING_CONSENT_OTHER_SETTINGS_KEY);
  });

  it("distinguishes decisions so a repeated event does not write twice", () => {
    const first = snapshot({ marketing: true });
    expect(consentDecisionKey(first)).toBe(consentDecisionKey(snapshot()));
    expect(consentDecisionKey(snapshot({ marketing: false }))).not.toBe(
      consentDecisionKey(first),
    );
    expect(consentDecisionKey(null)).toBe("");
  });
});
