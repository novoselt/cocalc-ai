/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Space, Tag, Typography } from "antd";
import type { Host } from "@cocalc/conat/hub/api/hosts";
import { React } from "@cocalc/frontend/app-framework";
import { hostFundingModeLabel } from "../utils/funding-mode";

export const HostOwnershipSummary: React.FC<{
  host: Host;
  compact?: boolean;
}> = ({ host, compact = false }) => {
  const ownerLabel =
    host.owner_display_name || host.owner_email_address || "Unknown owner";
  const showEmail =
    !!host.owner_email_address && host.owner_email_address !== ownerLabel;
  const billingOwner = host.billing_owner_account_id;
  const separateBillingOwner =
    billingOwner && billingOwner !== host.owner ? billingOwner : undefined;

  return (
    <Space orientation="vertical" size={compact ? 1 : 2}>
      <Typography.Text strong>{ownerLabel}</Typography.Text>
      {showEmail ? (
        <Typography.Text type="secondary">
          {host.owner_email_address}
        </Typography.Text>
      ) : null}
      {host.owner ? (
        <Typography.Text
          type="secondary"
          copyable={{ text: host.owner }}
          style={{ fontSize: 11 }}
        >
          Owner {host.owner}
        </Typography.Text>
      ) : null}
      <Space size={4} wrap>
        <Tag>{hostFundingModeLabel(host.funding_mode)}</Tag>
        {host.owner_home_bay_id ? (
          <Tag>Home bay: {host.owner_home_bay_id}</Tag>
        ) : null}
      </Space>
      {separateBillingOwner ? (
        <Typography.Text
          type="secondary"
          copyable={{ text: separateBillingOwner }}
          style={{ fontSize: 11 }}
        >
          Paid by {separateBillingOwner}
        </Typography.Text>
      ) : null}
    </Space>
  );
};
