/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { isValidUUID } from "@cocalc/util/misc";

export const BROWSER_RUNTIME_PRESENCE_AUTH_SCOPE = "browser-runtime-presence";
export const BROWSER_RUNTIME_PRESENCE_SERVICE = "browser-runtime-presence";
export const BROWSER_RUNTIME_PRESENCE_WILDCARD = `project.*.${BROWSER_RUNTIME_PRESENCE_SERVICE}.*`;

export interface BrowserRuntimePresenceSubject {
  project_id: string;
  account_id: string;
}

export function browserRuntimePresenceSubject({
  project_id,
  account_id,
}: BrowserRuntimePresenceSubject): string {
  if (!isValidUUID(project_id)) {
    throw new Error(`invalid project_id '${project_id}'`);
  }
  if (!isValidUUID(account_id)) {
    throw new Error(`invalid account_id '${account_id}'`);
  }
  return `project.${project_id}.${BROWSER_RUNTIME_PRESENCE_SERVICE}.${account_id}`;
}

export function parseBrowserRuntimePresenceSubject(
  subject: string,
): BrowserRuntimePresenceSubject | undefined {
  const parts = subject.split(".");
  if (
    parts.length !== 4 ||
    parts[0] !== "project" ||
    parts[2] !== BROWSER_RUNTIME_PRESENCE_SERVICE ||
    !isValidUUID(parts[1]) ||
    !isValidUUID(parts[3])
  ) {
    return;
  }
  return { project_id: parts[1], account_id: parts[3] };
}

export function isBrowserRuntimePresenceSubject(subject: string): boolean {
  const parts = subject.split(".");
  return (
    parts[0] === "project" && parts[2] === BROWSER_RUNTIME_PRESENCE_SERVICE
  );
}
