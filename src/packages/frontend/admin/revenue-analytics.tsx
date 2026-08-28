/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Checkbox, Space, Typography } from "antd";
import { useState } from "react";

import type {
  ComputeRevenueProduct,
  MembershipAllocationChannel,
} from "@cocalc/conat/hub/api/purchases";

import {
  ALL_MEMBERSHIP_CHANNELS,
  MEMBERSHIP_CHANNEL_OPTIONS,
} from "./membership-analytics-channels";
import { RevenueAnalyticsDashboard } from "./revenue-analytics-dashboard";

const { Text } = Typography;

export const ALL_COMPUTE_PRODUCTS: ComputeRevenueProduct[] = [
  "dedicated-host",
  "virtual-machine",
];
export const DEFAULT_COMPUTE_PRODUCTS = [...ALL_COMPUTE_PRODUCTS];

const COMPUTE_PRODUCT_OPTIONS: Array<{
  value: ComputeRevenueProduct;
  label: string;
}> = [
  { value: "dedicated-host", label: "Dedicated hosts" },
  { value: "virtual-machine", label: "Virtual machines" },
];

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
          aria-label="All membership channels"
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

export function ComputeProductSelector({
  value,
  onChange,
}: {
  value: ComputeRevenueProduct[];
  onChange: (value: ComputeRevenueProduct[]) => void;
}) {
  const allSelected = value.length === ALL_COMPUTE_PRODUCTS.length;
  const someSelected = value.length > 0 && !allSelected;
  return (
    <div role="group" aria-labelledby="revenue-analytics-compute-label">
      <Space wrap>
        <Text id="revenue-analytics-compute-label">Compute:</Text>
        <Checkbox
          aria-label="All compute products"
          checked={allSelected}
          indeterminate={someSelected}
          onChange={({ target: { checked } }) =>
            onChange(checked ? [...ALL_COMPUTE_PRODUCTS] : [])
          }
        >
          All
        </Checkbox>
        <Checkbox.Group
          aria-label="Compute products"
          value={value}
          onChange={(products) => onChange(products as ComputeRevenueProduct[])}
        >
          <Space wrap>
            {COMPUTE_PRODUCT_OPTIONS.map(({ label, value }) => (
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
  const [computeProducts, setComputeProducts] = useState<
    ComputeRevenueProduct[]
  >([...DEFAULT_COMPUTE_PRODUCTS]);

  return (
    <Space vertical size="middle" style={{ width: "100%" }}>
      <MembershipChannelSelector value={channels} onChange={setChannels} />
      <ComputeProductSelector
        value={computeProducts}
        onChange={setComputeProducts}
      />
      <RevenueAnalyticsDashboard
        channels={channels}
        computeProducts={computeProducts}
      />
    </Space>
  );
}
