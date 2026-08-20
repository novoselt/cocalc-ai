/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  buildMarketingConsentUpdate,
  getDefaultNotificationPreferences,
  MARKETING_CONSENT_OTHER_SETTINGS_KEY,
  MARKETING_EMAIL_CONSENT_RECORD_OTHER_SETTINGS_KEY,
  normalizeNotificationPreferences,
  OTHER_SETTINGS_NOTIFICATION_PREFERENCES_KEY,
} from "./notification-preferences";

describe("notification preferences", () => {
  it("provides safe first-release defaults", () => {
    expect(getDefaultNotificationPreferences()).toEqual({
      version: 1,
      email: {
        billing: "immediate",
        security: "immediate",
        membership_requests: "immediate",
        access_requests: "immediate",
        mentions: "immediate",
        chat_replies: "immediate",
        support: "immediate",
        ai: "off",
        course: "immediate",
        maintenance: "digest",
        onboarding: "immediate",
        product: "off",
      },
      digest: {
        time: "08:00",
        timezone: "auto",
      },
    });
  });

  it("normalizes partial user preferences", () => {
    expect(
      normalizeNotificationPreferences({
        email: {
          collaboration: "digest",
          access_requests: "none",
          membership_requests: "off",
          ai: "immediate",
          course: "none",
          product: "off",
          maintenance: "bad",
        },
      }),
    ).toEqual({
      version: 1,
      email: {
        billing: "immediate",
        security: "immediate",
        membership_requests: "immediate",
        access_requests: "none",
        mentions: "digest",
        chat_replies: "digest",
        support: "immediate",
        ai: "immediate",
        course: "none",
        maintenance: "digest",
        onboarding: "immediate",
        product: "off",
      },
      digest: {
        time: "08:00",
        timezone: "auto",
      },
    });
  });

  it("forces required categories to immediate", () => {
    expect(
      normalizeNotificationPreferences({
        email: {
          billing: "none",
          security: "digest",
        },
      }).email,
    ).toMatchObject({
      billing: "immediate",
      security: "immediate",
    });
  });

  it("restricts membership requests to email delivery modes", () => {
    expect(
      normalizeNotificationPreferences({
        email: {
          membership_requests: "digest",
          access_requests: "off",
        },
      }).email,
    ).toMatchObject({
      membership_requests: "digest",
      access_requests: "off",
    });
  });

  it("keeps the one-time onboarding status available in-app", () => {
    expect(
      normalizeNotificationPreferences({
        email: { onboarding: "none" },
      }).email.onboarding,
    ).toBe("immediate");
    expect(
      normalizeNotificationPreferences({
        email: { onboarding: "off" },
      }).email.onboarding,
    ).toBe("off");
  });

  it("preserves preferences supplied through an Immutable-style value", () => {
    expect(
      normalizeNotificationPreferences({
        toJS: () => ({ email: { mentions: "none", onboarding: "off" } }),
      }).email,
    ).toMatchObject({ mentions: "none", onboarding: "off" });
  });
});

describe("marketing consent updates", () => {
  it("records the banner decision without discarding other preferences", () => {
    const update = buildMarketingConsentUpdate({
      enabled: true,
      notificationPreferences: { email: { mentions: "none" } },
      recordedAt: new Date("2026-08-19T10:00:00.000Z"),
      source: "cookie-banner",
    });

    expect(update[MARKETING_CONSENT_OTHER_SETTINGS_KEY]).toBe(true);
    expect(update[MARKETING_EMAIL_CONSENT_RECORD_OTHER_SETTINGS_KEY]).toEqual({
      version: 1,
      enabled: true,
      source: "cookie-banner",
      recorded_at: "2026-08-19T10:00:00.000Z",
    });
    expect(update[OTHER_SETTINGS_NOTIFICATION_PREFERENCES_KEY]).toMatchObject({
      email: { mentions: "none", onboarding: "immediate", product: "digest" },
    });
  });

  it("turns every optional email off when marketing consent is declined", () => {
    const update = buildMarketingConsentUpdate({
      enabled: false,
      notificationPreferences: { email: { product: "digest" } },
      source: "cookie-banner",
    });

    expect(update[MARKETING_CONSENT_OTHER_SETTINGS_KEY]).toBe(false);
    // Onboarding defaults to "immediate", so declining has to switch it off
    // explicitly or a decline still receives the day-one onboarding email.
    expect(update[OTHER_SETTINGS_NOTIFICATION_PREFERENCES_KEY]).toMatchObject({
      email: { onboarding: "off", product: "off" },
    });
  });
});
