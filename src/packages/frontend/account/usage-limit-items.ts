/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { currency, humanSize } from "@cocalc/util/misc";

function formatCpuSeconds(seconds: number): string {
  const hours = seconds / 3600;
  const value = hours.toLocaleString(undefined, {
    maximumFractionDigits: hours < 1 ? 3 : 2,
  });
  return `${value} CPU-${hours === 1 ? "hour" : "hours"}`;
}

export function formatSharedComputePriority(priority: number): string {
  if (priority <= 0) return "Low";
  if (priority === 1) return "Medium";
  if (priority === 2) return "High";
  return "Highest";
}

export function getUsageLimitsItems(
  usageLimits: Record<string, unknown>,
): Array<{
  key: string;
  label: string;
  value: string;
}> {
  const items: Array<{
    key: string;
    label: string;
    value: string;
  }> = [];
  const computePriority = usageLimits.shared_compute_priority;
  if (typeof computePriority === "number" && Number.isFinite(computePriority)) {
    items.push({
      key: "shared_compute_priority",
      label: "CPU priority",
      value: formatSharedComputePriority(computePriority),
    });
  }
  const totalSoft = usageLimits.total_storage_soft_bytes;
  if (typeof totalSoft === "number" && Number.isFinite(totalSoft)) {
    items.push({
      key: "total_storage_soft_bytes",
      label: "Total account storage soft cap",
      value: humanSize(totalSoft),
    });
  }
  const totalHard = usageLimits.total_storage_hard_bytes;
  if (typeof totalHard === "number" && Number.isFinite(totalHard)) {
    items.push({
      key: "total_storage_hard_bytes",
      label: "Total account storage hard cap",
      value: humanSize(totalHard),
    });
  }
  const maxProjects = usageLimits.max_projects;
  if (typeof maxProjects === "number" && Number.isFinite(maxProjects)) {
    items.push({
      key: "max_projects",
      label: "Max projects",
      value: `${maxProjects}`,
    });
  }
  const maxSponsoredProjects = usageLimits.max_sponsored_running_projects;
  if (
    typeof maxSponsoredProjects === "number" &&
    Number.isFinite(maxSponsoredProjects)
  ) {
    items.push({
      key: "max_sponsored_running_projects",
      label: "Max sponsored running projects",
      value: `${maxSponsoredProjects}`,
    });
  }
  const maxSnapshots = usageLimits.max_snapshots_per_project;
  if (typeof maxSnapshots === "number" && Number.isFinite(maxSnapshots)) {
    items.push({
      key: "max_snapshots_per_project",
      label: "Max snapshots per project",
      value: `${maxSnapshots}`,
    });
  }
  const maxBackups = usageLimits.max_backups_per_project;
  if (typeof maxBackups === "number" && Number.isFinite(maxBackups)) {
    items.push({
      key: "max_backups_per_project",
      label: "Max backups per project",
      value: `${maxBackups}`,
    });
  }
  const rootfsCount = usageLimits.rootfs_count;
  if (typeof rootfsCount === "number" && Number.isFinite(rootfsCount)) {
    items.push({
      key: "rootfs_count",
      label: "Max images",
      value: `${rootfsCount}`,
    });
  }
  const rootfsTotalStorage = usageLimits.rootfs_total_storage_gb;
  if (
    typeof rootfsTotalStorage === "number" &&
    Number.isFinite(rootfsTotalStorage)
  ) {
    items.push({
      key: "rootfs_total_storage_gb",
      label: "Image total storage cap",
      value: `${rootfsTotalStorage} GB`,
    });
  }
  const rootfsMaxStorage = usageLimits.rootfs_max_storage_gb;
  if (
    typeof rootfsMaxStorage === "number" &&
    Number.isFinite(rootfsMaxStorage)
  ) {
    items.push({
      key: "rootfs_max_storage_gb",
      label: "Image per-image cap",
      value: `${rootfsMaxStorage} GB`,
    });
  }
  const rootfsOciImages = usageLimits.rootfs_oci_images;
  if (typeof rootfsOciImages === "boolean") {
    items.push({
      key: "rootfs_oci_images",
      label: "Remote OCI images",
      value: rootfsOciImages ? "Enabled" : "Disabled",
    });
  }
  const egress5h = usageLimits.egress_5h_bytes;
  if (typeof egress5h === "number" && Number.isFinite(egress5h)) {
    items.push({
      key: "egress_5h_bytes",
      label: "Data transfer 5-hour window",
      value: humanSize(egress5h),
    });
  }
  const egress7d = usageLimits.egress_7d_bytes;
  if (typeof egress7d === "number" && Number.isFinite(egress7d)) {
    items.push({
      key: "egress_7d_bytes",
      label: "Data transfer 7-day window",
      value: humanSize(egress7d),
    });
  }
  const cpu5h = usageLimits.cpu_5h_seconds;
  if (typeof cpu5h === "number" && Number.isFinite(cpu5h)) {
    items.push({
      key: "cpu_5h_seconds",
      label: "CPU 5-hour window",
      value: formatCpuSeconds(cpu5h),
    });
  }
  const cpu7d = usageLimits.cpu_7d_seconds;
  if (typeof cpu7d === "number" && Number.isFinite(cpu7d)) {
    items.push({
      key: "cpu_7d_seconds",
      label: "CPU 7-day window",
      value: formatCpuSeconds(cpu7d),
    });
  }
  const blobAccountStorage = usageLimits.blob_account_total_bytes;
  if (
    typeof blobAccountStorage === "number" &&
    Number.isFinite(blobAccountStorage)
  ) {
    items.push({
      key: "blob_account_total_bytes",
      label: "Account blob storage cap",
      value: humanSize(blobAccountStorage),
    });
  }
  const blobAccountCount = usageLimits.blob_account_count;
  if (
    typeof blobAccountCount === "number" &&
    Number.isFinite(blobAccountCount)
  ) {
    items.push({
      key: "blob_account_count",
      label: "Account blob count",
      value: `${blobAccountCount}`,
    });
  }
  const blobProjectStorage = usageLimits.blob_project_total_bytes;
  if (
    typeof blobProjectStorage === "number" &&
    Number.isFinite(blobProjectStorage)
  ) {
    items.push({
      key: "blob_project_total_bytes",
      label: "Per-project blob storage cap",
      value: humanSize(blobProjectStorage),
    });
  }
  const blobProjectCount = usageLimits.blob_project_count;
  if (
    typeof blobProjectCount === "number" &&
    Number.isFinite(blobProjectCount)
  ) {
    items.push({
      key: "blob_project_count",
      label: "Per-project blob count",
      value: `${blobProjectCount}`,
    });
  }
  const publicDirectoryShares = usageLimits.public_directory_shares;
  if (
    typeof publicDirectoryShares === "number" &&
    Number.isFinite(publicDirectoryShares)
  ) {
    items.push({
      key: "public_directory_shares",
      label: "Published directory shares",
      value: `${publicDirectoryShares}`,
    });
  }
  const spendingLimits = [
    {
      key: "prepaid_host_usage_limit_5h_usd",
      label: "Prepaid dedicated host spend, 5 hours",
    },
    {
      key: "prepaid_host_usage_limit_7d_usd",
      label: "Prepaid dedicated host spend, 7 days",
    },
    {
      key: "credit_spend_limit_5h_usd",
      label: "Postpaid dedicated host spend, 5 hours",
    },
    {
      key: "credit_spend_limit_7d_usd",
      label: "Postpaid dedicated host spend, 7 days",
    },
  ];
  for (const { key, label } of spendingLimits) {
    const value = usageLimits[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      items.push({ key, label, value: currency(value) });
    }
  }
  return items;
}
