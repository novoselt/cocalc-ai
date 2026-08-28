/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Button, Card, Flex, Space, Tag, Typography } from "antd";

import { TimeAgo } from "@cocalc/frontend/components";
import type { CrmTask } from "@cocalc/util/crm";
import { AccountIdentity } from "../receivables/account-names";

const { Text } = Typography;

export type CustomerTaskTransition = "complete" | "reschedule" | "cancel";

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function CustomerTaskCard({
  names,
  onTransition,
  task,
}: {
  names: Record<string, string>;
  onTransition: (transition: CustomerTaskTransition) => void;
  task: CrmTask;
}) {
  return (
    <Card size="small">
      <Flex align="start" justify="space-between" gap={12} wrap>
        <div>
          <Text strong>{task.subject}</Text>
          <br />
          <Text type="secondary">
            {humanize(task.type)} ·{" "}
            <AccountIdentity
              accountId={task.assignee_account_id}
              names={names}
            />
          </Text>
        </div>
        <div style={{ textAlign: "right" }}>
          <Tag
            color={
              task.priority === "urgent"
                ? "red"
                : task.priority === "high"
                  ? "orange"
                  : "default"
            }
          >
            {humanize(task.priority)}
          </Tag>
          <br />
          <Text
            type={new Date(task.due_at) < new Date() ? "danger" : "secondary"}
          >
            Due <TimeAgo date={task.due_at} />
          </Text>
        </div>
      </Flex>
      <Space size={8} wrap style={{ marginTop: 12 }}>
        <Button
          onClick={() => onTransition("complete")}
          size="small"
          type="primary"
        >
          Complete
        </Button>
        <Button onClick={() => onTransition("reschedule")} size="small">
          Reschedule
        </Button>
        <Button danger onClick={() => onTransition("cancel")} size="small">
          Cancel
        </Button>
      </Space>
    </Card>
  );
}
