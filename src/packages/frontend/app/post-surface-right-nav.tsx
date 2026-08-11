/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import BalanceButton from "@cocalc/frontend/purchases/balance-button";
import { AIUsageWarning } from "@cocalc/frontend/purchases/ai-usage-warning";
import { ManagedEgressWarning } from "@cocalc/frontend/purchases/managed-egress-warning";
import { AccountStorageWarning } from "@cocalc/frontend/purchases/account-storage-warning";
import { AccountCpuWarning } from "@cocalc/frontend/purchases/account-cpu-warning";

import { Notification } from "./notifications";
import type { PageStyle } from "./top-nav-consts";

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
