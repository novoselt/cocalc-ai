/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Button, Space } from "antd";
import { useEffect, useState } from "react";

import { openAccountSettings } from "@cocalc/frontend/account/settings-routing";
import { useActions, useTypedRedux } from "@cocalc/frontend/app-framework";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import type { MembershipTrialOffer } from "@cocalc/conat/hub/api/purchases";

export const MEMBERSHIP_TRIAL_BANNER_DISMISSED =
  "membership_trial_banner_dismissed";

export function formatTrialOfferLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, or ${labels.at(-1)}`;
}

export function MembershipTrialBanner() {
  const accountActions = useActions("account");
  const accountId = useTypedRedux("account", "account_id");
  const accountReady = useTypedRedux("account", "is_ready");
  const impersonation = useTypedRedux("account", "impersonation");
  const isLoggedIn = useTypedRedux("account", "is_logged_in");
  const otherSettings = useTypedRedux("account", "other_settings");
  const stripeEnabled = !!useTypedRedux("customize", "stripe_enabled");
  const [data, setData] = useState<{
    accountId: string;
    offers: MembershipTrialOffer[];
  }>();
  const [dismissedAccountId, setDismissedAccountId] = useState<string>();
  const permanentlyDismissed =
    otherSettings?.get?.(MEMBERSHIP_TRIAL_BANNER_DISMISSED) === true;
  const dismissed = permanentlyDismissed || dismissedAccountId === accountId;

  useEffect(() => {
    setData(undefined);
    if (
      !accountReady ||
      !isLoggedIn ||
      !accountId ||
      !stripeEnabled ||
      impersonation != null ||
      dismissed
    ) {
      return;
    }
    let canceled = false;
    void webapp_client.conat_client.hub.purchases
      .getMembershipTrialOffers({})
      .then((value) => {
        if (!canceled) setData({ accountId, offers: value });
      })
      .catch(() => {
        if (!canceled) setData({ accountId, offers: [] });
      });
    return () => {
      canceled = true;
    };
  }, [
    accountId,
    accountReady,
    dismissed,
    impersonation,
    isLoggedIn,
    stripeEnabled,
  ]);

  if (
    !accountId ||
    data?.accountId !== accountId ||
    dismissed ||
    !data.offers.length
  ) {
    return null;
  }

  const labels = formatTrialOfferLabels(data.offers.map(({ label }) => label));
  return (
    <Alert
      banner
      closable
      onClose={() => {
        setDismissedAccountId(accountId);
        accountActions.set_other_settings(
          MEMBERSHIP_TRIAL_BANNER_DISMISSED,
          true,
        );
      }}
      showIcon
      style={{ marginBottom: "10px", paddingBlock: "6px" }}
      title={
        <Space size="small" wrap>
          <strong>Free trial available</strong>
          <span>Claim your free trial for a {labels} membership.</span>
          <Button
            size="small"
            onClick={() =>
              openAccountSettings(
                { page: "membership" },
                { openMembershipPlanChooser: true },
              )
            }
          >
            View plans
          </Button>
        </Space>
      }
      type="info"
    />
  );
}
