/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getServerSettings } from "@cocalc/database/settings/server-settings";

export type ComputeVmMode =
  | "disabled"
  | "reconcile_only"
  | "admin_canary"
  | "enabled";

export type ComputeEnvironment = "development" | "staging" | "production";

export interface ComputeVmConfig {
  mode: ComputeVmMode;
  environment: ComputeEnvironment;
  admin_allowlist: Set<string>;
  gcp_service_account_json?: string;
  gcp_project_id?: string;
  gcp_subnetwork?: string;
  gcp_network_tag: string;
  staging_legacy_provider: boolean;
  max_active_per_account: number;
  max_active_total: number;
  max_vcpus: number;
  max_ttl_minutes: number;
  max_boot_disk_gb: number;
  max_authorized_cost_usd: number;
}

type Settings = Record<string, any>;

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  return Math.floor(positiveNumber(value, fallback));
}

function environmentFromSettings(settings: Settings): ComputeEnvironment {
  const forced = `${process.env.COCALC_COMPUTE_VM_ENVIRONMENT ?? ""}`
    .trim()
    .toLowerCase();
  if (["development", "staging", "production"].includes(forced)) {
    return forced as ComputeEnvironment;
  }
  const dns = `${settings.dns ?? ""}`.trim().toLowerCase();
  if (dns === "cocalc.ai" || dns === "www.cocalc.ai") return "production";
  if (dns.includes("staging")) return "staging";
  return "development";
}

function parseMode(
  value: unknown,
  environment: ComputeEnvironment,
): { mode: ComputeVmMode; automatic: boolean } {
  const raw = `${value ?? "auto"}`.trim().toLowerCase() || "auto";
  if (raw === "auto") {
    return {
      mode: environment === "production" ? "disabled" : "admin_canary",
      automatic: true,
    };
  }
  if (
    raw !== "disabled" &&
    raw !== "reconcile_only" &&
    raw !== "admin_canary" &&
    raw !== "enabled"
  ) {
    throw new Error(`invalid managed compute VM mode '${value}'`);
  }
  return { mode: raw, automatic: false };
}

function parseAllowlist(value: unknown): Set<string> {
  return new Set(
    `${value ?? ""}`
      .split(/[\s,]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parseServiceAccount(value: unknown): {
  json?: string;
  project_id?: string;
} {
  const json = `${value ?? ""}`.trim();
  if (!json) return {};
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("managed compute VM GCP service account JSON is invalid");
  }
  const project_id = `${parsed?.project_id ?? ""}`.trim();
  if (!project_id || !`${parsed?.client_email ?? ""}`.trim()) {
    throw new Error(
      "managed compute VM GCP service account JSON must include project_id and client_email",
    );
  }
  return { json, project_id };
}

export function resolveComputeVmConfig(settings: Settings): ComputeVmConfig {
  const environment = environmentFromSettings(settings);
  const { mode, automatic } = parseMode(settings.compute_vm_mode, environment);
  const serviceAccount = parseServiceAccount(
    settings.compute_vm_gcp_service_account_json,
  );
  const gcp_subnetwork = `${settings.compute_vm_gcp_subnetwork ?? ""}`.trim();
  const staging_legacy_provider =
    automatic && environment === "staging" && serviceAccount.json == null;

  return {
    mode,
    environment,
    admin_allowlist: parseAllowlist(settings.compute_vm_admin_allowlist),
    gcp_service_account_json: serviceAccount.json,
    gcp_project_id: serviceAccount.project_id,
    gcp_subnetwork: gcp_subnetwork || undefined,
    gcp_network_tag:
      `${settings.compute_vm_gcp_network_tag ?? ""}`.trim() ||
      "cocalc-compute-vm",
    staging_legacy_provider,
    max_active_per_account: positiveInteger(
      settings.compute_vm_max_active_per_account,
      1,
    ),
    max_active_total: positiveInteger(settings.compute_vm_max_active_total, 4),
    max_vcpus: positiveInteger(settings.compute_vm_max_vcpus, 16),
    max_ttl_minutes: positiveInteger(
      settings.compute_vm_max_ttl_minutes,
      24 * 60,
    ),
    max_boot_disk_gb: positiveInteger(
      settings.compute_vm_max_boot_disk_gb,
      200,
    ),
    max_authorized_cost_usd: positiveNumber(
      settings.compute_vm_max_authorized_cost_usd,
      25,
    ),
  };
}

export async function getComputeVmConfig(): Promise<ComputeVmConfig> {
  return resolveComputeVmConfig((await getServerSettings()) as Settings);
}

export function requireComputeVmCreateAllowed(
  config: ComputeVmConfig,
  accountId: string,
): void {
  if (config.mode !== "admin_canary") {
    throw Object.assign(
      new Error(
        config.mode === "disabled" || config.mode === "reconcile_only"
          ? "managed compute VM creation is disabled"
          : "managed compute VM customer admission is not enabled yet",
      ),
      { code: 503 },
    );
  }
  if (
    !config.staging_legacy_provider &&
    !config.admin_allowlist.has(accountId.toLowerCase())
  ) {
    throw Object.assign(
      new Error("account is not allowlisted for the managed compute VM canary"),
      { code: 403 },
    );
  }
  if (config.environment === "production") {
    if (!config.gcp_service_account_json || !config.gcp_project_id) {
      throw new Error(
        "managed compute VM production credentials are not configured",
      );
    }
    if (!config.gcp_subnetwork) {
      throw new Error(
        "managed compute VM production subnetwork is not configured",
      );
    }
    if (
      !config.gcp_subnetwork.startsWith(`projects/${config.gcp_project_id}/`)
    ) {
      throw new Error(
        "managed compute VM subnetwork must belong to the dedicated credential project",
      );
    }
  }
}

export function requireComputeVmStartAllowed(
  config: ComputeVmConfig,
  accountId: string,
): void {
  requireComputeVmCreateAllowed(config, accountId);
}
