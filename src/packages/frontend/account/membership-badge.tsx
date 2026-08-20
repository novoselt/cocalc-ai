/*
 *  This file is part of CoCalc: Copyright © 2025 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button, ConfigProvider, theme } from "antd";
import { type ReactElement, useEffect, useState } from "react";

import { useAsyncEffect, useTypedRedux } from "@cocalc/frontend/app-framework";
import api from "@cocalc/frontend/client/api";
import { openAccountSettings } from "@cocalc/frontend/account/settings-routing";
import { Tooltip } from "@cocalc/frontend/components";
import type { MembershipResolution } from "@cocalc/conat/hub/api/purchases";
import { capitalize } from "@cocalc/util/misc";

interface MembershipTier {
  id: string;
  label?: string;
}

interface MembershipTiersResponse {
  tiers?: MembershipTier[];
}

interface MembershipBadgeData {
  accountId: string;
  membership: MembershipResolution;
  tiers: MembershipTier[];
}

export default function MembershipBadge(): ReactElement | null {
  const accountId = useTypedRedux("account", "account_id");
  const stripeEnabled = !!useTypedRedux("customize", "stripe_enabled");
  const { token } = theme.useToken();
  const [data, setData] = useState<MembershipBadgeData>();
  const [refreshToken, setRefreshToken] = useState<number>(0);

  useAsyncEffect(
    async (isMounted) => {
      if (!accountId) {
        setData(undefined);
        return;
      }
      try {
        const [membership, tiersResult] = await Promise.all([
          api("purchases/get-membership"),
          api("purchases/get-membership-tiers"),
        ]);
        if (!isMounted()) return;
        setData({
          accountId,
          membership: membership as MembershipResolution,
          tiers: (tiersResult as MembershipTiersResponse)?.tiers ?? [],
        });
      } catch {
        if (isMounted()) {
          setData(undefined);
        }
      }
    },
    [accountId, refreshToken],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => setRefreshToken((value) => value + 1);
    window.addEventListener("cocalc:membership-changed", refresh);
    return () => {
      window.removeEventListener("cocalc:membership-changed", refresh);
    };
  }, []);

  if (!accountId || data?.accountId !== accountId) {
    return null;
  }

  const membershipClass = data.membership.class;
  const tierLabel =
    data.tiers.find(({ id }) => id === membershipClass)?.label ??
    capitalize(membershipClass);
  const showUpgrade = data.membership.source === "free" && stripeEnabled;
  const buttonLabel = showUpgrade ? "Upgrade" : tierLabel;
  const actionDescription = showUpgrade
    ? "View plans or claim a site license."
    : "View details and change plans.";
  const description = showUpgrade
    ? `Upgrade. Current membership: ${tierLabel}. ${actionDescription}`
    : `Current membership: ${tierLabel}. ${actionDescription}`;

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: token.green6,
          colorPrimaryBg: token.green2,
          colorPrimaryBgHover: token.green3,
          colorPrimaryBorder: token.green4,
        },
      }}
    >
      <Tooltip
        title={
          <>
            <div>Current membership: {tierLabel}</div>
            <div>{actionDescription}</div>
          </>
        }
        placement="bottom"
      >
        <Button
          aria-label={description}
          color="primary"
          onClick={() => openAccountSettings({ page: "membership" })}
          size="small"
          variant="filled"
          style={{
            color: token.colorText,
            fontWeight: token.fontWeightStrong,
            marginInline: token.marginXXS,
            maxWidth: 120,
          }}
        >
          <span
            style={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {buttonLabel}
          </span>
        </Button>
      </Tooltip>
    </ConfigProvider>
  );
}
