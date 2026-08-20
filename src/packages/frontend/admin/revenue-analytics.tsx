/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Checkbox, Space, Typography } from "antd";
import { useState } from "react";

import type { MembershipAllocationChannel } from "@cocalc/conat/hub/api/purchases";

import {
  ALL_MEMBERSHIP_CHANNELS,
  MEMBERSHIP_CHANNEL_OPTIONS,
} from "./membership-analytics-channels";
import { MembershipAnalyticsDashboard } from "./membership-analytics-dashboard";

const { Text } = Typography;

export function MembershipChannelSelector({
  value,
  onChange,
}: {
  value: MembershipAllocationChannel[];
  onChange: (value: MembershipAllocationChannel[]) => void;
}) {
  const allSelected = value.length === ALL_MEMBERSHIP_CHANNELS.length;
  const someSelected = value.length > 0 && !allSelected;

  return (
    <div role="group" aria-labelledby="revenue-analytics-memberships-label">
      <Space wrap>
        <Text id="revenue-analytics-memberships-label">Memberships:</Text>
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={({ target: { checked } }) =>
            onChange(checked ? [...ALL_MEMBERSHIP_CHANNELS] : [])
          }
        >
          All
        </Checkbox>
        <Checkbox.Group
          aria-label="Membership channels"
          value={value}
          onChange={(channels) =>
            onChange(channels as MembershipAllocationChannel[])
          }
        >
          <Space wrap>
            {MEMBERSHIP_CHANNEL_OPTIONS.map(({ label, value }) => (
              <Checkbox key={value} value={value}>
                {label}
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      </Space>
    </div>
  );
}

export function RevenueAnalyticsAdmin() {
  const [channels, setChannels] = useState<MembershipAllocationChannel[]>([
    ...ALL_MEMBERSHIP_CHANNELS,
  ]);

  return (
    <Space vertical size="middle" style={{ width: "100%" }}>
      <MembershipChannelSelector value={channels} onChange={setChannels} />
      <MembershipAnalyticsDashboard channels={channels} />
    </Space>
  );
}
