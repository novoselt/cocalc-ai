/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button, Space, Typography } from "antd";

const { Text } = Typography;

export function ActiveUsersMapSummary({
  total,
  mapped,
  unavailable,
  onShowUnavailable,
}: {
  total: number;
  mapped: number;
  unavailable: number;
  onShowUnavailable: () => void;
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
      <Text type="secondary">·</Text>
      {unavailable > 0 ? (
        <Button type="link" size="small" onClick={onShowUnavailable}>
          Location unavailable: <strong>{unavailable}</strong>
        </Button>
      ) : (
        <Text>
          Location unavailable: <Text strong>0</Text>
        </Text>
      )}
    </Space>
  );
}
