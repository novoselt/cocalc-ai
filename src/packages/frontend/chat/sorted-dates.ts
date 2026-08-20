/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { cmp } from "@cocalc/util/misc";

import { dateValue, field, parentMessageId } from "./access";
import type { ChatMessageTyped, ChatMessages, NumChildren } from "./types";
import { orderLinearThreadMessages } from "./utils";

// Messages are sorted using each message record's `date` value. Avoid relying
// on Map key shape, since cache internals are migrating away from date keys.
export function getSortedDates(
  messages: ChatMessages,
  _account_id: string,
  visibleKeys?: Set<string>,
): {
  dates: string[];
  numChildren: NumChildren;
} {
  if (messages == null) {
    return { dates: [], numChildren: {} };
  }

  const visibleMessages: ChatMessageTyped[] = [];
  const visibleById = new Map<string, ChatMessageTyped>();
  const numChildren: NumChildren = {};
  for (const [, message] of messages) {
    if (message == null) continue;
    const messageDate = dateValue(message);
    if (!messageDate) continue;
    const messageKey = `${messageDate.valueOf()}`;
    if (visibleKeys && !visibleKeys.has(messageKey)) continue;
    const messageId = `${field<string>(message, "message_id") ?? ""}`.trim();
    visibleMessages.push(message);
    if (messageId) visibleById.set(messageId, message);
  }

  for (const message of visibleMessages) {
    const parentId = parentMessageId(message);
    if (!parentId) continue;
    const parent = visibleById.get(parentId);
    const date = dateValue(parent)?.valueOf();
    if (date != null) {
      numChildren[date] = (numChildren[date] ?? 0) + 1;
    }
  }

  const groups = new Map<string, ChatMessageTyped[]>();
  for (const message of visibleMessages) {
    const threadId = `${field<string>(message, "thread_id") ?? ""}`.trim();
    const groupKey =
      threadId ||
      `${field<string>(message, "message_id") ?? dateValue(message)?.valueOf() ?? Math.random()}`;
    const bucket = groups.get(groupKey) ?? [];
    bucket.push(message);
    groups.set(groupKey, bucket);
  }

  const orderedGroups = Array.from(groups.values())
    .map((group) => orderLinearThreadMessages(group))
    .sort((a, b) => {
      const aTime = dateValue(a[0])?.valueOf() ?? Number.POSITIVE_INFINITY;
      const bTime = dateValue(b[0])?.valueOf() ?? Number.POSITIVE_INFINITY;
      return cmp(aTime, bTime);
    });

  const dates: string[] = [];
  for (const group of orderedGroups) {
    for (const message of group) {
      const date = dateValue(message)?.valueOf();
      if (date != null) dates.push(`${date}`);
    }
  }
  return { dates, numChildren };
}
