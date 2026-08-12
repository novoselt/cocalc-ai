/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { redux } from "@cocalc/frontend/app-framework";

import { dateValue, field } from "./access";
import { newest_content } from "./utils";
import { getUserName } from "./user-name";

export function messageToMarkdown(
  message,
  options?: { includeHeader?: boolean; logMarkdown?: string },
): string {
  const includeHeader = options?.includeHeader ?? true;
  let value = newest_content(message);
  const logMarkdown = options?.logMarkdown;
  if (logMarkdown) {
    value = `${value}\n\n**Log**\n\n${logMarkdown}`;
  }
  if (!includeHeader) return value;

  const userMap = redux.getStore("users").get("user_map");
  const sender = getUserName(
    userMap,
    field<string>(message, "sender_id") ?? "",
  );
  const date = dateValue(message)?.toString() ?? "";
  return `*From:* ${sender}  \n*Date:* ${date}  \n\n${value}`;
}
