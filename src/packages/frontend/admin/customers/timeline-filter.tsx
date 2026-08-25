/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Flex, Input, Typography } from "antd";

import { Icon } from "@cocalc/frontend/components";

const { Text } = Typography;

export function TimelineFilter({
  matchingCount,
  onChange,
  totalCount,
  value,
  visibleCount,
}: {
  matchingCount: number;
  onChange: (value: string) => void;
  totalCount: number;
  value: string;
  visibleCount: number;
}) {
  return (
    <Flex vertical gap={12}>
      <Input
        allowClear
        aria-label="Filter customer timeline"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Filter by event, system, ticket, or details"
        prefix={<Icon name="search" />}
        value={value}
      />
      <Text aria-live="polite" role="status" type="secondary">
        Showing {visibleCount} of {matchingCount} matching events
        {matchingCount !== totalCount ? ` (${totalCount} total)` : ""}
      </Text>
    </Flex>
  );
}
