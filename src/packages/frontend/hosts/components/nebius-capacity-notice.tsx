/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Space, Typography } from "antd";
import type { AlertProps } from "antd";
import type { CSSProperties } from "react";

import type { HostCatalog } from "@cocalc/conat/hub/api/hosts";
import {
  getNebiusCapacityInfo,
  type ProviderSelection,
} from "../providers/registry";

const { Text } = Typography;

function capacityAlertType(
  available: number | undefined,
  availabilityLevel: string,
  dataState: string,
  reported: boolean,
  supported: boolean,
): AlertProps["type"] {
  if (
    !supported ||
    availabilityLevel === "limit_reached" ||
    (reported && available === 0)
  ) {
    return "error";
  }
  if (!reported || dataState !== "fresh" || availabilityLevel === "low") {
    return "warning";
  }
  if (availabilityLevel === "high") return "success";
  return "info";
}

export function NebiusCapacityNotice({
  catalog,
  selection,
  style,
}: {
  catalog?: HostCatalog;
  selection: ProviderSelection;
  style?: CSSProperties;
}) {
  const info = getNebiusCapacityInfo(catalog, selection);
  const details = [
    selection.machine_type,
    selection.region,
    info.fabric,
    info.effectiveAt
      ? `measured ${new Date(info.effectiveAt).toLocaleString()}`
      : undefined,
  ].filter(Boolean);

  return (
    <Alert
      showIcon
      type={capacityAlertType(
        info.available,
        info.availabilityLevel,
        info.dataState,
        info.reported,
        info.supported,
      )}
      title={info.summary}
      description={
        <Space direction="vertical" size={2}>
          {details.length > 0 && (
            <Text type="secondary">{details.join(" · ")}</Text>
          )}
          <Text type="secondary">
            Nebius Capacity Advisor is advisory and does not reserve a VM;
            availability can change before provisioning completes.
          </Text>
        </Space>
      }
      style={style}
    />
  );
}
