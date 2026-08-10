/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { capitalize, humanSize } from "./misc";

export interface ManagedEgressPolicySummary {
  blocked_by?: "5h" | "7d";
  managed_egress_5h_bytes?: number;
  managed_egress_7d_bytes?: number;
  egress_5h_bytes?: number;
  egress_7d_bytes?: number;
  managed_egress_categories_5h_bytes?: Record<string, number>;
  managed_egress_categories_7d_bytes?: Record<string, number>;
}

function formatManagedEgressCategory(category: string): string {
  if (category === "file-download") return "File downloads";
  if (category === "http-proxy") return "App server HTTP traffic";
  if (category === "ws-proxy") return "App server WebSocket traffic";
  if (category === "ssh") return "SSH traffic";
  if (category === "interactive-conat") return "Interactive session traffic";
  if (category === "control-plane-conat") return "Account control traffic";
  if (category === "backup-upload") return "Project backup uploads";
  if (category === "raw-network") return "Project outbound network traffic";
  return capitalize(category.replace(/[-_]/g, " "));
}

function formatByteCount(bytes: number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "unknown";
  }
  return humanSize(bytes);
}

function formatCategoryBreakdown(
  categories: Record<string, number> | undefined,
): string | undefined {
  const breakdown = Object.entries(categories ?? {})
    .filter(
      ([, bytes]) =>
        typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0,
    )
    .map(
      ([category, bytes]) =>
        `${formatManagedEgressCategory(category)}: ${formatByteCount(bytes)}`,
    );
  return breakdown.length > 0 ? breakdown.join(", ") : undefined;
}

export function formatManagedEgressPolicyDetails(
  policy: ManagedEgressPolicySummary,
): string[] {
  const lines: string[] = [];
  if (policy.blocked_by === "5h") {
    lines.push("Limit triggered by the 5-hour network usage window.");
  } else if (policy.blocked_by === "7d") {
    lines.push("Limit triggered by the 7-day network usage window.");
  }
  if (policy.egress_5h_bytes != null) {
    lines.push(
      `5-hour usage: ${formatByteCount(policy.managed_egress_5h_bytes ?? 0)} / ${formatByteCount(policy.egress_5h_bytes)}.`,
    );
  }
  if (policy.egress_7d_bytes != null) {
    lines.push(
      `7-day usage: ${formatByteCount(policy.managed_egress_7d_bytes ?? 0)} / ${formatByteCount(policy.egress_7d_bytes)}.`,
    );
  }
  const breakdown5h = formatCategoryBreakdown(
    policy.managed_egress_categories_5h_bytes,
  );
  if (breakdown5h) {
    lines.push(`5-hour network usage by category: ${breakdown5h}.`);
  }
  const breakdown7d = formatCategoryBreakdown(
    policy.managed_egress_categories_7d_bytes,
  );
  if (breakdown7d) {
    lines.push(`7-day network usage by category: ${breakdown7d}.`);
  }
  return lines;
}
