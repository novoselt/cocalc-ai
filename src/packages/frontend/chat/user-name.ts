/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { chatBotName, isChatBot } from "@cocalc/frontend/account/chatbot";
import { displayNameFromUserRecord } from "@cocalc/frontend/users/display-name";

export function getUserName(userMap, accountId: string): string {
  if (isChatBot(accountId)) {
    return chatBotName(accountId);
  }
  if (userMap == null) return "Unknown";
  const account = userMap.get(accountId);
  if (account == null) return "Unknown";
  return displayNameFromUserRecord(account) || "Unknown";
}
