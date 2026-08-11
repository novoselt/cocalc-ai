/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { I18NBanner, useShowI18NBanner } from "./i18n-banner";
import { Notification } from "./notifications";
import type { PageStyle } from "./top-nav-consts";
import AutomaticUpdateNotice from "./automatic-update-notice";
import { CookieWarning, LocalStorageWarning } from "./warnings";
import { TeamLicenseWarningBanner } from "./team-license-warning-banner";
import { VerifyEmail } from "./verify-email-banner";
import { LegacyMigrationCtaBanner } from "./legacy-migration-cta-banner";
import { ImportPublicUrlModal } from "./import-public-url-modal";
import PopconfirmModal from "./popconfirm-modal";
import SettingsModal from "./settings-modal";
import { OnboardingEmailPrompt } from "./onboarding-email-prompt";
import BalanceButton from "@cocalc/frontend/purchases/balance-button";
import { AIUsageWarning } from "@cocalc/frontend/purchases/ai-usage-warning";
import { ManagedEgressWarning } from "@cocalc/frontend/purchases/managed-egress-warning";
import { AccountStorageWarning } from "@cocalc/frontend/purchases/account-storage-warning";
import { AccountCpuWarning } from "@cocalc/frontend/purchases/account-cpu-warning";

export function PostSurfaceRightNav({
  isLoggedIn,
  pageStyle,
  showMentions,
}: {
  isLoggedIn: boolean;
  pageStyle: PageStyle;
  showMentions: boolean;
}) {
  return (
    <>
      <BalanceButton minimal topBar />
      <AIUsageWarning pageStyle={pageStyle} />
      <AccountCpuWarning pageStyle={pageStyle} />
      <AccountStorageWarning pageStyle={pageStyle} />
      <ManagedEgressWarning pageStyle={pageStyle} />
      {isLoggedIn ? (
        <Notification
          type="notifications"
          active={showMentions}
          pageStyle={pageStyle}
        />
      ) : undefined}
    </>
  );
}

export function PostSurfaceBanners({
  cookieWarning,
  fullscreen,
  localStorageWarning,
}: {
  cookieWarning: boolean;
  fullscreen: boolean;
  localStorageWarning: boolean;
}) {
  const showI18n = useShowI18NBanner();
  return (
    <>
      <AutomaticUpdateNotice />
      {cookieWarning ? <CookieWarning /> : undefined}
      {localStorageWarning ? <LocalStorageWarning /> : undefined}
      {showI18n ? <I18NBanner /> : undefined}
      <TeamLicenseWarningBanner />
      <VerifyEmail />
      {!fullscreen ? <LegacyMigrationCtaBanner /> : undefined}
    </>
  );
}

export function PostSurfaceModals() {
  return (
    <>
      <ImportPublicUrlModal />
      <PopconfirmModal />
      <SettingsModal />
      <OnboardingEmailPrompt />
    </>
  );
}
