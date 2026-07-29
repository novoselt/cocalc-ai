/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Alert } from "antd";
import { useEffect, useState } from "react";

import { webapp_client } from "@cocalc/frontend/webapp-client";
import {
  getDiskQuota,
  type ProjectDiskQuota,
} from "@cocalc/conat/project/storage-info";
import { withTimeout } from "@cocalc/util/async-utils";
import { human_readable_size } from "@cocalc/util/misc";
import { isProjectDiskQuotaStartBlocked } from "@cocalc/util/project-start-errors";

import DiskUsage from "./disk-usage";

const PROJECT_DISK_WARNING_THRESHOLD = 0.8;
const PROJECT_DISK_SEVERE_THRESHOLD = 0.9;
const PROJECT_DISK_QUOTA_POLL_MS = 60_000;
const PROJECT_DISK_QUOTA_TIMEOUT_MS = 15_000;

export type ProjectDiskQuotaWarningSeverity = "warning" | "severe" | "blocked";

export interface ProjectDiskQuotaWarning {
  severity: ProjectDiskQuotaWarningSeverity;
  percent: number;
  remaining: number;
  size: number;
  used: number;
}

export function getProjectDiskQuotaWarning(
  quota: ProjectDiskQuota | null | undefined,
): ProjectDiskQuotaWarning | undefined {
  if (
    quota == null ||
    !Number.isFinite(quota.used) ||
    !Number.isFinite(quota.size) ||
    quota.used < 0 ||
    quota.size <= 0
  ) {
    return;
  }
  const ratio = quota.used / quota.size;
  const blocked = isProjectDiskQuotaStartBlocked(quota);
  if (!blocked && ratio < PROJECT_DISK_WARNING_THRESHOLD) {
    return;
  }
  return {
    severity: blocked
      ? "blocked"
      : ratio >= PROJECT_DISK_SEVERE_THRESHOLD
        ? "severe"
        : "warning",
    percent: Math.max(0, Math.round(100 * ratio)),
    remaining: Math.max(0, quota.size - quota.used),
    size: quota.size,
    used: quota.used,
  };
}

function warningTitle(warning: ProjectDiskQuotaWarning): string {
  if (warning.severity === "blocked") {
    return "Project storage is full or nearly full";
  }
  return `Project storage is ${warning.percent}% full`;
}

function warningDescription(warning: ProjectDiskQuotaWarning): string {
  const usage = `${human_readable_size(warning.used)} of ${human_readable_size(
    warning.size,
  )}`;
  const remaining = human_readable_size(warning.remaining);
  if (warning.severity === "blocked") {
    return `${usage} is used, with only ${remaining} remaining. CoCalc may refuse to start the project, and writes or software installation can fail. Project storage includes live files and retained snapshot history.`;
  }
  return `${usage} is used, with ${remaining} remaining. Review large files and snapshots, or increase the quota, before writes and software installation begin to fail.`;
}

export function ProjectDiskQuotaWarningAlert({
  project_id,
  quota,
}: {
  project_id: string;
  quota: ProjectDiskQuota;
}) {
  const warning = getProjectDiskQuotaWarning(quota);
  const [dismissedWarningKey, setDismissedWarningKey] = useState("");
  const warningKey =
    warning?.severity === "warning" ? `warning:${warning.size}` : "";

  useEffect(() => {
    if (warning?.severity !== "warning") {
      setDismissedWarningKey("");
    }
  }, [warning?.severity]);

  if (
    warning == null ||
    (warning.severity === "warning" && dismissedWarningKey === warningKey)
  ) {
    return null;
  }

  return (
    <Alert
      action={
        <DiskUsage
          project_id={project_id}
          buttonText="Review storage"
          buttonSize="small"
        />
      }
      banner
      closable={warning.severity === "warning"}
      description={warningDescription(warning)}
      onClose={() => setDismissedWarningKey(warningKey)}
      showIcon
      title={warningTitle(warning)}
      type={warning.severity === "warning" ? "warning" : "error"}
    />
  );
}

export function ProjectDiskQuotaWarningBanner({
  project_id,
}: {
  project_id: string;
}) {
  const [quota, setQuota] = useState<ProjectDiskQuota | null>(null);

  useEffect(() => {
    let active = true;

    async function loadQuota(): Promise<void> {
      try {
        const client = await webapp_client.conat_client.projectConat({
          project_id,
          caller: "ProjectDiskQuotaWarningBanner",
        });
        const next = await withTimeout(
          getDiskQuota({ client, project_id }),
          PROJECT_DISK_QUOTA_TIMEOUT_MS,
        );
        if (active) {
          setQuota(next);
        }
      } catch {
        // A transient project-host connection failure should not replace a
        // previously valid quota sample with an unrelated warning.
      }
    }

    setQuota(null);
    void loadQuota();
    const interval = setInterval(
      () => void loadQuota(),
      PROJECT_DISK_QUOTA_POLL_MS,
    );
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [project_id]);

  if (quota == null) return null;
  return <ProjectDiskQuotaWarningAlert project_id={project_id} quota={quota} />;
}
