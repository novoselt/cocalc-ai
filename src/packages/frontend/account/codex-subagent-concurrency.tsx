/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Select, Typography } from "antd";
import { useMemo } from "react";
import { redux, useTypedRedux } from "@cocalc/frontend/app-framework";

const { Paragraph, Text } = Typography;

export const OTHER_SETTINGS_CODEX_MAX_CONCURRENT_SUBAGENTS =
  "codex_max_concurrent_subagents";
export const MIN_CODEX_CONCURRENT_SUBAGENTS = 1;
export const MAX_CODEX_CONCURRENT_SUBAGENTS = 16;

export function normalizeCodexMaxConcurrentSubagents(
  value: unknown,
): number | undefined {
  if (value == null || value === "" || value === "automatic") return;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return;
  return Math.min(
    MAX_CODEX_CONCURRENT_SUBAGENTS,
    Math.max(MIN_CODEX_CONCURRENT_SUBAGENTS, parsed),
  );
}

export function readCodexMaxConcurrentSubagents(
  otherSettings: { get?: (key: string) => unknown } | null | undefined,
): number | undefined {
  return normalizeCodexMaxConcurrentSubagents(
    otherSettings?.get?.(OTHER_SETTINGS_CODEX_MAX_CONCURRENT_SUBAGENTS),
  );
}

export function saveCodexMaxConcurrentSubagents(
  value: unknown,
): number | undefined {
  const normalized = normalizeCodexMaxConcurrentSubagents(value);
  redux
    .getActions("account")
    .set_other_settings(
      OTHER_SETTINGS_CODEX_MAX_CONCURRENT_SUBAGENTS,
      normalized ?? null,
    );
  return normalized;
}

export function CodexSubagentConcurrencyField({
  compact = false,
}: Readonly<{ compact?: boolean }>) {
  const otherSettings = useTypedRedux("account", "other_settings");
  const value = readCodexMaxConcurrentSubagents(otherSettings);
  const options = useMemo(
    () => [
      { value: "automatic", label: "Automatic (currently 3)" },
      ...Array.from({ length: MAX_CODEX_CONCURRENT_SUBAGENTS }, (_, index) => ({
        value: `${index + 1}`,
        label: `${index + 1}`,
      })),
    ],
    [],
  );

  return (
    <div
      style={{ marginTop: compact ? 0 : 16, marginBottom: compact ? 0 : 16 }}
    >
      <div style={{ marginBottom: 6 }}>
        <Text strong>Maximum concurrent subagents</Text>{" "}
        <Text type="secondary">(Account-wide)</Text>
      </div>
      <Select
        aria-label="Maximum concurrent Codex subagents"
        value={value == null ? "automatic" : `${value}`}
        style={{ width: "100%", maxWidth: 320 }}
        options={options}
        onChange={(next) => saveCodexMaxConcurrentSubagents(next)}
      />
      <Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0 }}>
        Codex may use this many workers in parallel, in addition to the manager.
        Higher values can consume your Codex or API allowance much faster. A
        change applies when a Codex session is next loaded.
      </Paragraph>
    </div>
  );
}
