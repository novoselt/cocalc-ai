/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ActiveUserMapUser } from "@cocalc/conat/hub/api/system";
import Plot from "@cocalc/frontend/components/plotly";
import { COLORS } from "@cocalc/util/theme";

const UNKNOWN_DOMAIN = "Unknown";
const MIN_DOMAIN_PERCENT = 1.5;

export interface ActiveUserEmailDomainCount {
  domain: string;
  count: number;
}

function emailDomain(email?: string | null): string {
  const normalized = email?.trim().toLowerCase() ?? "";
  const separator = normalized.lastIndexOf("@");
  if (
    separator <= 0 ||
    separator === normalized.length - 1 ||
    normalized.slice(separator + 1).includes(" ")
  ) {
    return UNKNOWN_DOMAIN;
  }
  return normalized.slice(separator + 1);
}

function combineSmallDomainCounts(
  counts: ActiveUserEmailDomainCount[],
): ActiveUserEmailDomainCount[] {
  const total = counts.reduce((sum, { count }) => sum + count, 0);
  if (total === 0) return [];
  const visible: ActiveUserEmailDomainCount[] = [];
  let other = 0;
  for (const entry of [...counts].sort(
    (left, right) =>
      right.count - left.count || left.domain.localeCompare(right.domain),
  )) {
    if (entry.count * 100 >= total * MIN_DOMAIN_PERCENT) {
      visible.push(entry);
    } else {
      other += entry.count;
    }
  }
  if (other > 0) visible.push({ domain: "Other", count: other });
  return visible;
}

export function activeUserEmailDomainCounts(
  users: ActiveUserMapUser[],
): ActiveUserEmailDomainCount[] {
  const counts = new Map<string, number>();
  for (const user of users) {
    const domain = emailDomain(user.email_address);
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return combineSmallDomainCounts(
    [...counts.entries()].map(([domain, count]) => ({ domain, count })),
  );
}

function accessibilitySummary(
  counts: ActiveUserEmailDomainCount[],
  total: number,
): string {
  const userLabel = total === 1 ? "user" : "users";
  return `Email domains for ${total} active ${userLabel}: ${counts
    .map(({ domain, count }) => `${domain}, ${count}`)
    .join("; ")}.`;
}

export function ActiveUsersMapDomainChart({
  users,
}: {
  users: ActiveUserMapUser[];
}) {
  if (users.length === 0) return null;
  const counts = activeUserEmailDomainCounts(users);
  const labels = counts.map(({ domain }) => domain);
  const values = counts.map(({ count }) => count);
  const colors = counts.map(
    (_, index) => COLORS.CATEGORICAL[index % COLORS.CATEGORICAL.length],
  );

  const commonTrace = {
    type: "pie" as const,
    labels,
    values,
    sort: false,
    direction: "clockwise" as const,
    rotation: 135,
    marker: { colors },
    showlegend: false,
    automargin: true,
  };

  return (
    <div role="img" aria-label={accessibilitySummary(counts, users.length)}>
      <Plot
        data={[
          {
            ...commonTrace,
            texttemplate: "%{label}",
            textposition: "outside",
            hoverinfo: "skip",
          },
          {
            ...commonTrace,
            texttemplate: "%{value:d}",
            textposition: "inside",
            hovertemplate:
              "%{label}: %{value:d} active users (%{percent})<extra></extra>",
          },
        ]}
        layout={{
          height: 520,
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          showlegend: false,
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%" }}
      />
    </div>
  );
}
