/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Modal,
  Progress,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";

import type { LroEvent, LroSummary } from "@cocalc/conat/hub/api/lro";
import type {
  LegacyMigrationProjectRemediationDiffEntry,
  LegacyMigrationProjectRemediationStatusResponse,
} from "@cocalc/conat/hub/api/legacy-migration";
import { redux, useProjectFromMap } from "@cocalc/frontend/app-framework";
import { isDismissed, progressBarStatus } from "@cocalc/frontend/lro/utils";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { COLORS } from "@cocalc/util/theme";
import {
  LEGACY_RESTORE_ERROR_LABEL,
  LEGACY_RESTORE_LRO_LABEL,
  LEGACY_RESTORE_STATUS_LABEL,
  LEGACY_SOURCE_PROJECT_LABEL,
  legacyRestoreMissingArchiveEntriesFromError,
} from "@cocalc/util/legacy-migration";

const { Text } = Typography;
const FINAL_ARCHIVE_SNAPSHOT_PATH = ".snapshots/final-cocalc-com-archive";
const remediationSessionDismissedKeys = new Set<string>();

function labelValue(value: unknown): string {
  return `${value ?? ""}`.trim();
}

function projectLabels(project: any): Record<string, unknown> {
  return project?.get?.("labels")?.toJS?.() ?? project?.get?.("labels") ?? {};
}

function reopenDismissKey({
  project_id,
  opId,
}: {
  project_id: string;
  opId: string;
}): string {
  return `legacy-project-restore-reopened:${project_id}:${opId || "no-op"}`;
}

function activeRestoreSeenKey({
  project_id,
  opId,
}: {
  project_id: string;
  opId: string;
}): string {
  return `legacy-project-restore-active-seen:${project_id}:${opId || "no-op"}`;
}

function knownRestoredKey({
  project_id,
  opId,
}: {
  project_id: string;
  opId: string;
}): string {
  return `legacy-project-restore-known-restored:${project_id}:${opId || "no-op"}`;
}

function restoreIssueDismissKey({
  project_id,
  opId,
}: {
  project_id: string;
  opId: string;
}): string {
  return `legacy-project-restore-issue-dismissed:${project_id}:${opId || "no-op"}`;
}

function remediationSessionDismissKey({
  project_id,
  r2RefreshedAt,
}: {
  project_id: string;
  r2RefreshedAt?: string | null;
}): string {
  return `legacy-project-final-archive-remediation-session-dismissed:${project_id}:${r2RefreshedAt || "unknown"}`;
}

export function markLegacyProjectRestoreKnownRestored({
  project_id,
  opId,
}: {
  project_id: string;
  opId?: string | null;
}): void {
  try {
    globalThis.sessionStorage?.setItem(
      knownRestoredKey({ project_id, opId: labelValue(opId) }),
      "1",
    );
  } catch {}
}

function wasReopenDismissed(key: string): boolean {
  try {
    return globalThis.sessionStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markReopenDismissed(key: string): void {
  try {
    globalThis.sessionStorage?.setItem(key, "1");
  } catch {}
}

function wasActiveRestoreSeen(key: string): boolean {
  try {
    return globalThis.sessionStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markActiveRestoreSeen(key: string): void {
  try {
    globalThis.sessionStorage?.setItem(key, "1");
  } catch {}
}

function wasKnownRestored(key: string): boolean {
  try {
    return globalThis.sessionStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

function wasRestoreIssueDismissed(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markRestoreIssueDismissed(key: string): void {
  try {
    globalThis.localStorage?.setItem(key, "1");
  } catch {}
}

function wasRemediationSessionDismissed(key: string): boolean {
  return remediationSessionDismissedKeys.has(key);
}

function markRemediationSessionDismissed(key: string): void {
  remediationSessionDismissedKeys.add(key);
}

function isActiveRestoreStatus(status: string): boolean {
  return (
    status === "pending" || status === "restoring" || status === "indexing"
  );
}

function progressPercent({
  summary,
  progress,
}: {
  summary?: LroSummary;
  progress?: Extract<LroEvent, { type: "progress" }>;
}): number | undefined {
  const value =
    progress?.progress ??
    summary?.progress_summary?.progress ??
    (summary?.status === "succeeded" ? 100 : undefined);
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function progressText({
  summary,
  progress,
}: {
  summary?: LroSummary;
  progress?: Extract<LroEvent, { type: "progress" }>;
}): string {
  const phase = labelValue(progress?.phase ?? summary?.progress_summary?.phase);
  const message = labelValue(
    progress?.message ?? summary?.progress_summary?.message,
  );
  return [phase, message].filter(Boolean).join(": ");
}

function formatCount(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "";
}

function formatBytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (value < 1024) return `${Math.round(value).toLocaleString()} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = value / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && scaled >= 1024; i += 1) {
    scaled /= 1024;
    unit = units[i];
  }
  return `${scaled.toFixed(scaled < 10 ? 1 : 0)} ${unit}`;
}

function timestampMs(value: unknown): number | undefined {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : typeof value === "string"
          ? Date.parse(value)
          : undefined;
  return typeof ms === "number" && Number.isFinite(ms) ? ms : undefined;
}

function formatTimestamp(value: unknown): string {
  const ms = timestampMs(value);
  return ms == null ? "" : new Date(ms).toLocaleString();
}

function remediationDiffKindLabel(
  kind: LegacyMigrationProjectRemediationDiffEntry["kind"],
): string {
  switch (kind) {
    case "add":
      return "new";
    case "update":
      return "changed";
    case "delete":
      return "not in final archive";
    default:
      return "other";
  }
}

function remediationDiffKindColor(
  kind: LegacyMigrationProjectRemediationDiffEntry["kind"],
): string {
  switch (kind) {
    case "add":
      return "green";
    case "update":
      return "orange";
    case "delete":
      return "red";
    default:
      return "default";
  }
}

function formatRemediationCounts(
  status?: LegacyMigrationProjectRemediationStatusResponse,
): string {
  const counts = status?.diff_counts;
  if (!counts) return "";
  const parts = [
    counts.add ? `${counts.add.toLocaleString()} new` : "",
    counts.update ? `${counts.update.toLocaleString()} changed` : "",
    counts.delete
      ? `${counts.delete.toLocaleString()} only in current project`
      : "",
    counts.other ? `${counts.other.toLocaleString()} other` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

function restoreQueueAndTimingText({
  effectiveStatus,
  summary,
  progress,
}: {
  effectiveStatus: string;
  summary?: LroSummary;
  progress?: Extract<LroEvent, { type: "progress" }>;
}): string {
  const phase = labelValue(
    progress?.phase ?? summary?.progress_summary?.phase,
  ).toLowerCase();
  const isQueued =
    effectiveStatus === "pending" ||
    summary?.status === "queued" ||
    phase === "queued";
  const started = formatTimestamp(summary?.started_at ?? summary?.created_at);
  if (!isQueued && !started) return "";
  const prefix = isQueued ? "Restore is queued." : "Restore is running.";
  return started ? `${prefix} LRO started ${started}.` : prefix;
}

function progressDetailText({
  summary,
  progress,
}: {
  summary?: LroSummary;
  progress?: Extract<LroEvent, { type: "progress" }>;
}): string {
  const detail =
    progress?.detail ??
    (summary?.progress_summary?.detail as Record<string, unknown> | undefined);
  if (!detail || typeof detail !== "object") return "";
  const parts: string[] = [];
  const bytes = formatBytes((detail as any).bytes);
  const expectedBytes = formatBytes((detail as any).expected_bytes);
  if (bytes && expectedBytes) {
    parts.push(`${bytes} of ${expectedBytes}`);
  } else if (bytes) {
    parts.push(bytes);
  }
  const extracted = formatCount((detail as any).extracted_count);
  const files = formatCount((detail as any).file_count);
  if (extracted && files) {
    parts.push(`${extracted} of ${files} entries`);
  } else if (files) {
    parts.push(`${files} entries`);
  }
  const uncompressed = formatBytes((detail as any).uncompressed_bytes);
  if (uncompressed) {
    parts.push(`${uncompressed} unpacked`);
  }
  const currentPath = labelValue((detail as any).current_path);
  if (currentPath) {
    parts.push(currentPath);
  }
  const skipped = formatCount((detail as any).skipped_file_count);
  const skippedBytes = formatBytes((detail as any).skipped_bytes);
  if (skipped) {
    parts.push(
      skippedBytes
        ? `${skipped} oversized file(s) skipped (${skippedBytes})`
        : `${skipped} oversized file(s) skipped`,
    );
  }
  return parts.join(" • ");
}

type OptimisticRestoreState = {
  opId: string;
  status: string;
};

function skippedRestoreText({
  summary,
  progress,
  error,
}: {
  summary?: LroSummary;
  progress?: Extract<LroEvent, { type: "progress" }>;
  error?: string;
}): string {
  const detail =
    progress?.detail ??
    (summary?.progress_summary?.detail as
      | Record<string, unknown>
      | undefined) ??
    (summary?.result as Record<string, unknown> | undefined);
  if (!detail || typeof detail !== "object") return "";
  const parts: string[] = [];
  const skippedCount = (detail as any).skipped_file_count;
  if (
    typeof skippedCount === "number" &&
    Number.isFinite(skippedCount) &&
    skippedCount > 0
  ) {
    const bytes = formatBytes((detail as any).skipped_bytes);
    const files = Array.isArray((detail as any).skipped_files)
      ? (detail as any).skipped_files
      : [];
    const shown = files
      .map((file) => labelValue(file?.path))
      .filter(Boolean)
      .slice(0, 5);
    const hidden = Math.max(0, skippedCount - shown.length);
    parts.push(
      `${formatCount(skippedCount)} oversized file(s) were not restored${
        bytes ? ` (${bytes})` : ""
      }.`,
    );
    if (shown.length > 0) {
      parts.push(
        `Skipped: ${shown.join(", ")}${hidden ? `, and ${hidden} more` : ""}.`,
      );
    }
  }
  const missingCount = (detail as any).missing_archive_file_count;
  if (
    typeof missingCount === "number" &&
    Number.isFinite(missingCount) &&
    missingCount > 0
  ) {
    const files = Array.isArray((detail as any).missing_archive_files)
      ? (detail as any).missing_archive_files
      : [];
    const shown = files.map(labelValue).filter(Boolean).slice(0, 5);
    const hidden = Math.max(0, missingCount - shown.length);
    parts.push(
      `${formatCount(missingCount)} archive entr${
        missingCount === 1 ? "y was" : "ies were"
      } listed but not restored.`,
    );
    if (shown.length > 0) {
      parts.push(
        `Missing: ${shown.join(", ")}${hidden ? `, and ${hidden} more` : ""}.`,
      );
    }
  }
  const missingFromError = legacyRestoreMissingArchiveEntriesFromError(error);
  if (missingFromError.length > 0 && parts.length === 0) {
    const shown = missingFromError.slice(0, 5);
    const hidden = Math.max(0, missingFromError.length - shown.length);
    parts.push(
      `${formatCount(missingFromError.length)} archive entr${
        missingFromError.length === 1 ? "y was" : "ies were"
      } listed but not restored.`,
    );
    parts.push(
      `Missing: ${shown.join(", ")}${hidden ? `, and ${hidden} more` : ""}.`,
    );
  }
  return parts.join(" ");
}

export function LegacyMigrationRestoreBanner({
  project_id,
}: {
  project_id: string;
}) {
  const project = useProjectFromMap(project_id);
  const labels = useMemo(() => projectLabels(project), [project]);
  const legacyProjectId = labelValue(labels[LEGACY_SOURCE_PROJECT_LABEL]);
  const labeledStatus = labelValue(labels[LEGACY_RESTORE_STATUS_LABEL]);
  const labeledError = labelValue(labels[LEGACY_RESTORE_ERROR_LABEL]);
  const opId = labelValue(labels[LEGACY_RESTORE_LRO_LABEL]);
  const [summary, setSummary] = useState<LroSummary>();
  const [progress, setProgress] =
    useState<Extract<LroEvent, { type: "progress" }>>();
  const [retrying, setRetrying] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [optimisticRestore, setOptimisticRestore] =
    useState<OptimisticRestoreState>();
  const effectiveOpId = optimisticRestore?.opId ?? opId;
  const effectiveStatus = optimisticRestore?.status ?? labeledStatus;
  const effectiveError = optimisticRestore ? "" : labeledError;
  const dismissKey = useMemo(
    () => reopenDismissKey({ project_id, opId: effectiveOpId }),
    [effectiveOpId, project_id],
  );
  const activeSeenKey = useMemo(
    () => activeRestoreSeenKey({ project_id, opId: effectiveOpId }),
    [effectiveOpId, project_id],
  );
  const restoreIssueKey = useMemo(
    () => restoreIssueDismissKey({ project_id, opId: effectiveOpId }),
    [effectiveOpId, project_id],
  );
  const [reopenDismissed, setReopenDismissed] = useState(() =>
    wasReopenDismissed(dismissKey),
  );
  const [activeRestoreSeen, setActiveRestoreSeen] = useState(() =>
    wasActiveRestoreSeen(activeSeenKey),
  );
  const [knownRestored, setKnownRestored] = useState(() =>
    wasKnownRestored(knownRestoredKey({ project_id, opId: effectiveOpId })),
  );
  const [restoreIssueDismissed, setRestoreIssueDismissed] = useState(() =>
    wasRestoreIssueDismissed(restoreIssueKey),
  );
  const [remediation, setRemediation] =
    useState<LegacyMigrationProjectRemediationStatusResponse>();
  const [remediationApplying, setRemediationApplying] = useState(false);
  const [remediationError, setRemediationError] = useState("");
  const [remediationDismissOpen, setRemediationDismissOpen] = useState(false);
  const remediationSessionKey = useMemo(
    () =>
      remediationSessionDismissKey({
        project_id,
        r2RefreshedAt: remediation?.r2_refreshed_at,
      }),
    [project_id, remediation?.r2_refreshed_at],
  );
  const [remediationSessionDismissed, setRemediationSessionDismissed] =
    useState(() => wasRemediationSessionDismissed(remediationSessionKey));

  useEffect(() => {
    if (optimisticRestore && opId === optimisticRestore.opId) {
      setOptimisticRestore(undefined);
    }
  }, [opId, optimisticRestore]);

  useEffect(() => {
    setReopenDismissed(wasReopenDismissed(dismissKey));
  }, [dismissKey]);

  useEffect(() => {
    setActiveRestoreSeen(wasActiveRestoreSeen(activeSeenKey));
  }, [activeSeenKey]);

  useEffect(() => {
    setKnownRestored(
      wasKnownRestored(knownRestoredKey({ project_id, opId: effectiveOpId })),
    );
  }, [effectiveOpId, project_id]);

  useEffect(() => {
    setRestoreIssueDismissed(wasRestoreIssueDismissed(restoreIssueKey));
  }, [restoreIssueKey]);

  useEffect(() => {
    setRemediationSessionDismissed(
      wasRemediationSessionDismissed(remediationSessionKey),
    );
  }, [remediationSessionKey]);

  useEffect(() => {
    let canceled = false;
    async function loadRemediation() {
      setRemediationError("");
      try {
        const status =
          await webapp_client.conat_client.hub.legacyMigration.getProjectRemediation(
            { project_id },
          );
        if (!canceled) {
          setRemediation(status);
        }
      } catch (err) {
        if (!canceled) setRemediationError(`${err}`);
      }
    }
    void loadRemediation();
    return () => {
      canceled = true;
    };
  }, [project_id]);

  useEffect(() => {
    setSummary(undefined);
    setProgress(undefined);
    if (!effectiveOpId) return;
    let closed = false;
    async function watch() {
      try {
        const current = await webapp_client.conat_client.hub.lro.get({
          op_id: effectiveOpId,
        });
        if (!closed) setSummary(current);
        await webapp_client.conat_client.lroWait({
          op_id: effectiveOpId,
          scope_type: "project",
          scope_id: project_id,
          timeout_ms: 24 * 60 * 60 * 1000,
          poll_ms: 5000,
          onProgress: (event) => {
            if (!closed) setProgress(event);
          },
          onSummary: (nextSummary) => {
            if (!closed) setSummary(nextSummary);
          },
        });
      } catch {}
    }
    void watch();
    return () => {
      closed = true;
    };
  }, [effectiveOpId, project_id]);

  const failed =
    effectiveStatus === "failed" ||
    summary?.status === "failed" ||
    summary?.status === "canceled" ||
    summary?.status === "expired";
  const restored =
    knownRestored ||
    effectiveStatus === "restored" ||
    summary?.status === "succeeded";
  const skippedText = skippedRestoreText({ summary, progress });

  useEffect(() => {
    if (!legacyProjectId || restored || failed) return;
    if (
      isActiveRestoreStatus(effectiveStatus) ||
      summary?.status === "queued" ||
      summary?.status === "running"
    ) {
      markActiveRestoreSeen(activeSeenKey);
      setActiveRestoreSeen(true);
    }
  }, [
    activeSeenKey,
    effectiveStatus,
    failed,
    legacyProjectId,
    restored,
    summary?.status,
  ]);

  async function openFinalArchiveSnapshot() {
    try {
      await redux
        .getProjectActions(project_id)
        ?.open_directory?.(FINAL_ARCHIVE_SNAPSHOT_PATH, true, true);
    } catch (err) {
      void message.error(`Unable to open final archive snapshot: ${err}`);
    }
  }

  async function safelyCopyFinalArchive() {
    setRemediationApplying(true);
    setRemediationError("");
    try {
      const status =
        await webapp_client.conat_client.hub.legacyMigration.applyProjectRemediation(
          { project_id },
        );
      setRemediation(status);
      void message.success(
        "Final cocalc.com files were safely copied without overwriting newer local edits.",
      );
    } catch (err) {
      setRemediationError(`${err}`);
      void message.error(`${err}`);
    } finally {
      setRemediationApplying(false);
    }
  }

  async function dismissRemediationForever() {
    try {
      const status =
        await webapp_client.conat_client.hub.legacyMigration.dismissProjectRemediation(
          { project_id, forever: true },
        );
      setRemediation(status);
      setRemediationDismissOpen(false);
      void message.success("Final archive warning dismissed for this project.");
    } catch (err) {
      void message.error(`${err}`);
    }
  }

  function dismissRemediationForSession() {
    markRemediationSessionDismissed(remediationSessionKey);
    setRemediationSessionDismissed(true);
    setRemediationDismissOpen(false);
  }

  if (
    remediation?.needs_remediation &&
    remediation.prepared_at &&
    !remediation.dismissed_forever &&
    !remediationSessionDismissed
  ) {
    const countsText = formatRemediationCounts(remediation);
    const applied = !!remediation.applied_at;
    const diffFileCount = remediation.diff_file_count ?? 0;
    return (
      <>
        <Alert
          showIcon
          type={applied ? "success" : "warning"}
          message={
            applied
              ? "Final cocalc.com archive has been safely copied"
              : "This restored project may be missing final cocalc.com changes"
          }
          description={
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Text>
                This project was restored before we refreshed its final
                cocalc.com archive. Your current project has been preserved. The
                final archive is available as a read-only snapshot, and the safe
                copy action does not overwrite files that are newer in this
                project.
              </Text>
              {remediation.restored_at || remediation.r2_refreshed_at ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Restored{" "}
                  {formatTimestamp(remediation.restored_at) ||
                    "at an unknown time"}
                  {remediation.r2_refreshed_at
                    ? `; final archive refreshed ${formatTimestamp(
                        remediation.r2_refreshed_at,
                      )}`
                    : ""}
                  .
                </Text>
              ) : null}
              {countsText ? (
                <Text>
                  Difference summary: <Text strong>{countsText}</Text>.
                </Text>
              ) : (
                <Text>Final archive comparison found no file differences.</Text>
              )}
              {remediation.diff_files && remediation.diff_files.length > 0 ? (
                <div
                  style={{
                    background: COLORS.GRAY_LLL,
                    border: `1px solid ${COLORS.GRAY_LL}`,
                    maxHeight: 180,
                    overflow: "auto",
                    padding: "8px 10px",
                  }}
                >
                  {remediation.diff_files.map((entry) => (
                    <div key={`${entry.kind}:${entry.path}`}>
                      <Tag color={remediationDiffKindColor(entry.kind)}>
                        {remediationDiffKindLabel(entry.kind)}
                      </Tag>
                      <Text code>{entry.path}</Text>
                    </div>
                  ))}
                  {remediation.truncated ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Showing the first{" "}
                      {remediation.diff_files.length.toLocaleString()} of{" "}
                      {diffFileCount.toLocaleString()} changed paths.
                    </Text>
                  ) : null}
                </div>
              ) : null}
              {applied && remediation.safety_snapshot_name ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Before copying, we created safety snapshot{" "}
                  <Text code>{remediation.safety_snapshot_name}</Text>.
                </Text>
              ) : null}
              {remediationError ? (
                <Text type="danger">{remediationError}</Text>
              ) : null}
              <Space wrap>
                <Button onClick={() => void openFinalArchiveSnapshot()}>
                  Open final archive snapshot
                </Button>
                <Button
                  type="primary"
                  disabled={applied}
                  loading={remediationApplying}
                  onClick={() => void safelyCopyFinalArchive()}
                >
                  Safely copy final cocalc.com files
                </Button>
                <Button onClick={() => setRemediationDismissOpen(true)}>
                  Dismiss
                </Button>
              </Space>
            </Space>
          }
        />
        <Modal
          open={remediationDismissOpen}
          title="Dismiss final archive warning?"
          onCancel={() => setRemediationDismissOpen(false)}
          footer={
            <Space wrap>
              <Button onClick={() => setRemediationDismissOpen(false)}>
                Cancel
              </Button>
              <Button onClick={dismissRemediationForSession}>
                Just this session
              </Button>
              <Button
                danger
                type="primary"
                onClick={() => void dismissRemediationForever()}
              >
                Dismiss forever
              </Button>
            </Space>
          }
        >
          <Space direction="vertical">
            <Text>
              “Just this session” hides this banner until you reload the
              project. “Dismiss forever” records that choice for this project.
            </Text>
            <Text type="secondary">
              The read-only final archive snapshot remains available at{" "}
              <Text code>{FINAL_ARCHIVE_SNAPSHOT_PATH}</Text>.
            </Text>
          </Space>
        </Modal>
      </>
    );
  }
  if (!legacyProjectId) return null;
  if (restoreIssueDismissed && failed) return null;

  async function reopenProject() {
    setReopening(true);
    try {
      if (effectiveOpId) {
        void webapp_client.conat_client.hub.lro
          .dismiss({ op_id: effectiveOpId })
          .catch((err) => {
            console.warn("failed to dismiss completed legacy restore LRO", err);
          });
      }
      markReopenDismissed(dismissKey);
      setReopenDismissed(true);
      webapp_client.conat_client.releaseProjectHostRouting({ project_id });
      redux.getActions("page").close_project_tab(project_id);
      redux.removeProjectReferences(project_id);
      await Promise.resolve();
      await redux.getActions("projects").open_project({
        project_id,
        switch_to: true,
        restore_session: true,
        change_history: true,
      });
    } catch (err) {
      setReopenDismissed(false);
      void message.error(`${err}`);
    } finally {
      setReopening(false);
    }
  }

  if (restored) {
    if (!activeRestoreSeen) return null;
    if (reopenDismissed || isDismissed(summary)) return null;
    return (
      <Alert
        showIcon
        type="success"
        message="Legacy project files restored"
        description={
          <Space direction="vertical" size={10}>
            <Text>
              The imported files are now available. Reopen the project to reset
              the file browser state and show the restored directory listing.
            </Text>
            {skippedText ? (
              <Text type="warning" style={{ fontSize: 12 }}>
                {skippedText}
              </Text>
            ) : null}
            <Button
              type="primary"
              size="large"
              loading={reopening}
              onClick={() => void reopenProject()}
            >
              Reopen Project
            </Button>
          </Space>
        }
      />
    );
  }

  if (summary != null && isDismissed(summary)) {
    return null;
  }

  const percent = progressPercent({ summary, progress });
  const detail = progressText({ summary, progress });
  const detailExtra = progressDetailText({ summary, progress });
  const queueAndTiming = restoreQueueAndTimingText({
    effectiveStatus,
    summary,
    progress,
  });
  const error = failed ? labelValue(summary?.error) || effectiveError : "";
  const warningText = skippedRestoreText({ summary, progress, error });
  const errorIsMissingArchiveEntries =
    legacyRestoreMissingArchiveEntriesFromError(error).length > 0;

  async function retryRestore() {
    setRetrying(true);
    try {
      const result =
        await webapp_client.conat_client.hub.legacyMigration.retryProjectRestore(
          {
            legacy_project_id: legacyProjectId,
          },
        );
      setOptimisticRestore({
        opId: result.restore_lro_op_id ?? "",
        status: result.restore_status,
      });
      setSummary(undefined);
      setProgress(undefined);
      void message.success("Legacy project file restore restarted.");
      if (result.restore_lro_op_id && result.restore_lro_op_id !== opId) {
        await webapp_client.conat_client.hub.lro.get({
          op_id: result.restore_lro_op_id,
        });
      }
    } catch (err) {
      void message.error(`${err}`);
    } finally {
      setRetrying(false);
    }
  }

  async function acceptRestoreIssue() {
    markRestoreIssueDismissed(restoreIssueKey);
    setRestoreIssueDismissed(true);
    if (effectiveOpId) {
      await webapp_client.conat_client.hub.lro
        .dismiss({ op_id: effectiveOpId })
        .catch((err) => {
          console.warn("failed to dismiss legacy restore LRO", err);
        });
    }
    void message.success("Legacy restore warning hidden for this project.");
  }

  return (
    <Alert
      showIcon
      type={failed ? "error" : "info"}
      message={
        failed
          ? "Legacy project file restore failed"
          : "Restoring legacy project files"
      }
      description={
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text>
            This project was created from a legacy archive. Files may be
            incomplete until the restore finishes. You can leave this page and
            come back later.
          </Text>
          {queueAndTiming ? (
            <Text type="secondary">{queueAndTiming}</Text>
          ) : null}
          {detail ? <Text type="secondary">{detail}</Text> : null}
          {detailExtra ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {detailExtra}
            </Text>
          ) : null}
          {warningText ? (
            <Text type="warning" style={{ fontSize: 12 }}>
              {warningText}
            </Text>
          ) : null}
          {percent != null ? (
            <Progress
              percent={percent}
              size="small"
              status={progressBarStatus(summary?.status)}
            />
          ) : null}
          {error && !errorIsMissingArchiveEntries ? (
            <Text type="danger">{error}</Text>
          ) : null}
          {failed ? (
            <Space wrap>
              <Button
                loading={retrying}
                onClick={() => void retryRestore()}
                size="small"
              >
                Retry full file restore
              </Button>
              <Button onClick={() => void acceptRestoreIssue()} size="small">
                Accept and hide
              </Button>
            </Space>
          ) : null}
        </Space>
      }
    />
  );
}
