/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button, Space, Typography } from "antd";

const { Text } = Typography;

export function ActiveUsersMapSummary({
  total,
  mapped,
  usageMetricsNotEnabled,
  unavailable,
  onShowUnavailable,
}: {
  total: number;
  mapped: number;
  usageMetricsNotEnabled?: number;
  unavailable: number;
  onShowUnavailable?: () => void;
}) {
  return (
    <Space wrap>
      <Text>
        Active users: <Text strong>{total}</Text>
      </Text>
      <Text type="secondary">·</Text>
      <Text>
        On map: <Text strong>{mapped}</Text>
      </Text>
      {usageMetricsNotEnabled != null && (
        <Space>
          <Text type="secondary">·</Text>
          <Text>
            Usage metrics not enabled:{" "}
            <Text strong>{usageMetricsNotEnabled}</Text>
          </Text>
        </Space>
      )}
      <Text type="secondary">·</Text>
      {unavailable > 0 && onShowUnavailable ? (
        <Button type="link" size="small" onClick={onShowUnavailable}>
          Location unavailable: <strong>{unavailable}</strong>
        </Button>
      ) : (
        <Text>
          Location unavailable: <Text strong>{unavailable}</Text>
        </Text>
      )}
    </Space>
  );
}
