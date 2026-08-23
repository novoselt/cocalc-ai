/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export function projectArchiveReasonText({
  reason,
  archivedAt,
}: {
  reason?: string | null;
  archivedAt?: Date | string | number | null;
}): string | undefined {
  let text: string | undefined;
  if (reason === "free-inactive") {
    text = "Archived automatically after prolonged inactivity.";
  } else if (reason === "all-collaborators-banned") {
    text = "Archived because all collaborators were banned.";
  } else if (reason === "manual") {
    text = "Archived manually.";
  }
  if (!text || archivedAt == null) return text;
  const date = new Date(archivedAt);
  if (!Number.isFinite(date.getTime())) return text;
  return `${text.slice(0, -1)} on ${date.toLocaleString()}.`;
}
