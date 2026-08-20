/*
 *  This file is part of CoCalc: Copyright © 2025 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Select, Space, Switch, Table } from "antd";
import type { TableColumnsType } from "antd";
import { defineMessage } from "react-intl";

import { redux, useTypedRedux } from "@cocalc/frontend/app-framework";
import { setMarketingConsent as setMarketingBannerConsent } from "@cocalc/frontend/cookie-consent";
import { labels } from "@cocalc/frontend/i18n";
import {
  buildMarketingConsentUpdate,
  MARKETING_CONSENT_OTHER_SETTINGS_KEY,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EMAIL_MODES,
  OTHER_SETTINGS_NOTIFICATION_PREFERENCES_KEY,
  notificationModeSendsEmail,
  normalizeNotificationPreferences,
  type NotificationCategory,
  type NotificationEmailMode,
} from "@cocalc/util/notification-preferences";
import { CookieConsentSection } from "./cookie-consent-settings";
import { SettingsCard } from "./settings-card";
import type { SettingsPageDefinition } from "./settings-page";

type NotificationCategoryRow = (typeof NOTIFICATION_CATEGORIES)[number];

export const ACCOUNT_PREFERENCES_COMMUNICATION_PAGE = {
  component: AccountPreferencesCommunication,
  description: defineMessage({
    id: "account.settings.overview.communication",
    defaultMessage: "Notification preferences and communication settings.",
  }),
  icon: "mail",
  key: "communication",
  label: labels.communication,
} satisfies SettingsPageDefinition;

export function AccountPreferencesCommunication(): React.JSX.Element {
  const other_settings = useTypedRedux("account", "other_settings");
  const email_address_verified = useTypedRedux(
    "account",
    "email_address_verified",
  );
  const email_address = useTypedRedux("account", "email_address");
  const isVerified = !!email_address_verified?.get(email_address ?? "");

  function on_change(name: string, value: any): void {
    redux.getActions("account").set_other_settings(name, value);
  }

  function rawNotificationPreferences() {
    const raw = other_settings?.get?.(
      OTHER_SETTINGS_NOTIFICATION_PREFERENCES_KEY,
    );
    return raw?.toJS?.() ?? raw;
  }

  const notificationPreferences = normalizeNotificationPreferences(
    rawNotificationPreferences(),
  );
  const marketingConsent =
    other_settings?.get?.(MARKETING_CONSENT_OTHER_SETTINGS_KEY) === true;
  const cookieBannerEnabled = useTypedRedux(
    "customize",
    "cookie_banner_enabled",
  );

  function setNotificationEmailMode(
    category: NotificationCategory,
    mode: NotificationEmailMode,
  ) {
    const next = normalizeNotificationPreferences(notificationPreferences);
    next.email[category] = mode;
    on_change(OTHER_SETTINGS_NOTIFICATION_PREFERENCES_KEY, next);
  }

  function setMarketingConsent(enabled: boolean): void {
    // Same consent, two entry points.  When the banner takes the change it
    // emits a consent event, and the app's consent listener performs the single
    // account write; writing here as well would race it.
    if (
      setMarketingBannerConsent(enabled, "communication-settings") === "changed"
    ) {
      return;
    }
    redux.getActions("account").set_other_settings_many(
      buildMarketingConsentUpdate({
        enabled,
        notificationPreferences: rawNotificationPreferences(),
        source: "communication-settings",
      }),
    );
  }

  function deliveryOptions(category: NotificationCategoryRow) {
    return NOTIFICATION_EMAIL_MODES.map(({ key, label }) => ({
      disabled: category.requiredEmailMode
        ? key !== category.requiredEmailMode
        : category.allowedEmailModes != null &&
          !category.allowedEmailModes.includes(key),
      label,
      value: key,
    }));
  }

  const notificationColumns: TableColumnsType<NotificationCategoryRow> = [
    {
      dataIndex: "label",
      key: "category",
      title: "Category",
    },
    {
      dataIndex: "description",
      key: "description",
      title: "Scope",
    },
    {
      key: "delivery",
      render: (_, category) => (
        <Select
          aria-label={`Delivery for ${category.label}`}
          value={notificationPreferences.email[category.key]}
          onChange={(mode) => setNotificationEmailMode(category.key, mode)}
          options={deliveryOptions(category)}
          popupMatchSelectWidth={false}
        />
      ),
      title: "Delivery",
    },
  ];

  function render_notification_email_preferences() {
    const hasEmailDelivery = NOTIFICATION_CATEGORIES.some((category) =>
      notificationModeSendsEmail(notificationPreferences.email[category.key]),
    );
    return (
      <Space vertical style={{ width: "100%" }}>
        {!isVerified && hasEmailDelivery && (
          <Alert
            type="warning"
            showIcon
            title="Verify your email address to receive notification email."
          />
        )}
        <div style={{ maxWidth: "100%", width: "fit-content" }}>
          <Table
            columns={notificationColumns}
            dataSource={NOTIFICATION_CATEGORIES}
            pagination={false}
            rowKey="key"
          />
        </div>
      </Space>
    );
  }

  // One card for both halves of the same consent: the banner collects them
  // together, so presenting them apart would read as two separate settings.
  function render_communication_and_privacy() {
    return (
      <SettingsCard
        title={
          cookieBannerEnabled
            ? "Communication and privacy"
            : "Onboarding and marketing emails"
        }
      >
        <Space vertical size="middle" style={{ width: "100%" }}>
          <Space>
            <Switch
              aria-label="Allow optional onboarding and marketing emails"
              checked={marketingConsent}
              onChange={setMarketingConsent}
            />
            <span>
              Allow optional onboarding help, product tips, and marketing
              emails.
            </span>
          </Space>
          <CookieConsentSection />
        </Space>
      </SettingsCard>
    );
  }

  return (
    <Space vertical size="middle" style={{ width: "100%" }}>
      {render_communication_and_privacy()}
      <SettingsCard title="Notifications">
        {render_notification_email_preferences()}
      </SettingsCard>
    </Space>
  );
}
