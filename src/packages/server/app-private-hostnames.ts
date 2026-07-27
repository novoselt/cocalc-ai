/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomBytes } from "node:crypto";
import LRU from "lru-cache";
import getLogger from "@cocalc/backend/logger";
import getPool from "@cocalc/database/pool";
import siteUrl from "@cocalc/database/settings/site-url";
import { getServerSettings } from "@cocalc/database/settings/server-settings";
import {
  deleteAppSubdomainDns,
  ensureAppSubdomainDns,
  ensureCloudflareProjectHostSslRule,
  getCnameTargetForHostname,
  hasDns,
} from "@cocalc/server/cloud/dns";
import { normalizeCloudflareHostname } from "@cocalc/server/cloud/derived-domains";
import { reuseInFlight } from "@cocalc/util/reuse-in-flight";

const logger = getLogger("server:app-private-hostnames");
const TABLE = "project_app_private_hostnames";
const HOST_CACHE_TTL_MS = 30_000;
const MAX_PRIVATE_HOSTNAMES_PER_PROJECT = 32;
const APP_ID_RE = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/i;

const hostCache = new LRU<string, PrivateAppRouteTarget | null>({
  max: 20_000,
  ttl: HOST_CACHE_TTL_MS,
});

export interface PrivateAppRouteTarget {
  project_id: string;
  app_id: string;
  base_path: string;
}

export interface ProjectAppPrivateHostnamePolicy {
  enabled: boolean;
  site_hostname?: string;
  host_hostname?: string;
  dns_target?: string;
  warnings: string[];
}

export interface ProjectAppPrivateHostnameRecord extends PrivateAppRouteTarget {
  label: string;
  hostname: string;
  url: string;
  dns_record_id?: string;
  dns_target?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_dns_error?: string;
}

export interface ReconcileProjectAppPrivateHostnamesResult {
  project_id: string;
  checked: number;
  updated: number;
  errors: Array<{ app_id: string; error: string }>;
}

const ensureSchema = reuseInFlight(
  async () => {
    await getPool().query(
      `
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          project_id UUID NOT NULL,
          app_id TEXT NOT NULL,
          label TEXT NOT NULL,
          hostname TEXT NOT NULL,
          base_path TEXT NOT NULL,
          dns_record_id TEXT,
          dns_target TEXT,
          created_by UUID NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_dns_error TEXT,
          PRIMARY KEY (project_id, app_id),
          UNIQUE (hostname)
        )
      `,
    );
  },
  { createKey: () => "schema" },
);

function normalizeHostHeader(host?: string): string {
  const raw = `${host ?? ""}`.trim().toLowerCase();
  if (!raw) return "";
  return raw.split(":")[0] ?? "";
}

function normalizeAppId(value: string): string {
  const app_id = `${value ?? ""}`.trim();
  if (!APP_ID_RE.test(app_id)) {
    throw new Error(
      "app_id must be 1-64 letters, digits, dots, underscores, or hyphens",
    );
  }
  return app_id;
}

function appBasePath(app_id: string): string {
  return `/apps/${normalizeAppId(app_id)}`;
}

function randomLabel(): string {
  return `dev-${randomBytes(8).toString("hex")}`;
}

function settingEnabled(value: unknown): boolean {
  if (value === true) return true;
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

async function privateHostnamesEnabled(): Promise<boolean> {
  const settings = await getServerSettings();
  return settingEnabled(settings.project_hosts_app_private_hostnames_enabled);
}

async function getSiteHostname(): Promise<string | undefined> {
  const settings = await getServerSettings();
  const configured = normalizeCloudflareHostname(
    settings.project_hosts_app_private_hostname_domain as string | undefined,
  );
  if (configured) {
    return configured;
  }
  try {
    const hostname = normalizeCloudflareHostname(
      new URL(await siteUrl()).hostname,
    );
    if (
      !hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost")
    ) {
      return;
    }
    return hostname;
  } catch {
    return;
  }
}

interface ProjectHostPublicRoute {
  host_id: string;
  hostname: string;
}

async function getProjectHostPublicRoute(
  project_id: string,
): Promise<ProjectHostPublicRoute | undefined> {
  const { rows } = await getPool().query(
    `
      SELECT project_hosts.id AS host_id,
             project_hosts.public_url AS public_url
      FROM projects
      LEFT JOIN project_hosts ON project_hosts.id = projects.host_id
      WHERE projects.project_id=$1
    `,
    [project_id],
  );
  const host_id = `${rows[0]?.host_id ?? ""}`.trim();
  const raw = `${rows[0]?.public_url ?? ""}`.trim();
  if (!host_id || !raw) return;
  try {
    return { host_id, hostname: new URL(raw).hostname.toLowerCase() };
  } catch {
    return {
      host_id,
      hostname: raw
        .replace(/^https?:\/\//i, "")
        .split("/")[0]
        .split(":")[0]
        .toLowerCase(),
    };
  }
}

async function resolveDnsTarget(hostname: string): Promise<string> {
  const cname = await getCnameTargetForHostname(hostname);
  if (cname?.endsWith(".cfargotunnel.com")) {
    throw new Error(
      "the assigned project host uses a Cloudflare tunnel; private app hostnames require a direct project-host route",
    );
  }
  return hostname;
}

export async function getProjectAppPrivateHostnamePolicy(
  project_id: string,
): Promise<ProjectAppPrivateHostnamePolicy> {
  const warnings: string[] = [];
  const enabledBySetting = await privateHostnamesEnabled();
  const dnsConfigured = await hasDns();
  const site_hostname = await getSiteHostname();
  const host_hostname = (await getProjectHostPublicRoute(project_id))?.hostname;

  if (!enabledBySetting) {
    warnings.push("Private project app hostnames are disabled by site policy.");
  }
  if (!dnsConfigured) {
    warnings.push("Cloudflare DNS automation is not configured.");
  }
  if (!site_hostname) {
    warnings.push("The site has no eligible public hostname.");
  }
  if (!host_hostname) {
    warnings.push("The project has no assigned public project-host hostname.");
  }

  let dns_target: string | undefined;
  if (host_hostname && dnsConfigured) {
    try {
      dns_target = await resolveDnsTarget(host_hostname);
    } catch (err) {
      warnings.push(`Unable to resolve the project-host DNS target: ${err}`);
    }
  }

  return {
    enabled:
      enabledBySetting &&
      dnsConfigured &&
      !!site_hostname &&
      !!host_hostname &&
      !!dns_target,
    site_hostname,
    host_hostname,
    dns_target,
    warnings,
  };
}

function mapRecord(row: any): ProjectAppPrivateHostnameRecord {
  return {
    project_id: `${row.project_id}`,
    app_id: `${row.app_id}`,
    label: `${row.label}`,
    hostname: `${row.hostname}`.toLowerCase(),
    base_path: `${row.base_path}`,
    url: `https://${`${row.hostname}`.toLowerCase()}`,
    dns_record_id: row.dns_record_id ?? undefined,
    dns_target: row.dns_target ?? undefined,
    created_by: `${row.created_by}`,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    last_dns_error: row.last_dns_error ?? undefined,
  };
}

async function noteDnsError({
  project_id,
  app_id,
  error,
  dns_record_id,
}: {
  project_id: string;
  app_id: string;
  error: unknown;
  dns_record_id?: string;
}): Promise<void> {
  await getPool().query(
    `
      UPDATE ${TABLE}
      SET last_dns_error=$3,
          dns_record_id=COALESCE($4, dns_record_id),
          updated_at=NOW()
      WHERE project_id=$1 AND app_id=$2
    `,
    [project_id, app_id, `${error}`.slice(0, 2000), dns_record_id ?? null],
  );
}

export async function reserveProjectAppPrivateHostname(opts: {
  project_id: string;
  app_id: string;
  created_by: string;
}): Promise<ProjectAppPrivateHostnameRecord> {
  await ensureSchema();
  const project_id = `${opts.project_id ?? ""}`.trim();
  const created_by = `${opts.created_by ?? ""}`.trim();
  const app_id = normalizeAppId(opts.app_id);
  if (!project_id) throw new Error("project_id is required");
  if (!created_by) throw new Error("created_by is required");

  const policy = await getProjectAppPrivateHostnamePolicy(project_id);
  if (
    !policy.enabled ||
    !policy.site_hostname ||
    !policy.dns_target ||
    !policy.host_hostname
  ) {
    throw new Error(
      policy.warnings[0] ?? "Private project app hostnames are unavailable.",
    );
  }

  const route = await getProjectHostPublicRoute(project_id);
  if (!route || route.hostname !== policy.host_hostname) {
    throw new Error(
      "The project host placement changed while reserving its private app hostname.",
    );
  }
  await ensureCloudflareProjectHostSslRule({
    hostname: route.hostname,
    host_id: route.host_id,
    zone_hostname: policy.site_hostname,
  });

  const pool = getPool();
  const existing = await inspectProjectAppPrivateHostname({
    project_id,
    app_id,
  });
  if (!existing) {
    const { rows } = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM ${TABLE}
        WHERE project_id=$1
      `,
      [project_id],
    );
    if (Number(rows[0]?.count ?? 0) >= MAX_PRIVATE_HOSTNAMES_PER_PROJECT) {
      throw new Error(
        `a project may have at most ${MAX_PRIVATE_HOSTNAMES_PER_PROJECT} private app hostnames`,
      );
    }
  }

  let row: any;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const label = existing?.label ?? randomLabel();
    const hostname = existing?.hostname ?? `${label}.${policy.site_hostname}`;
    try {
      const result = await pool.query(
        `
          INSERT INTO ${TABLE}
            (project_id, app_id, label, hostname, base_path, created_by)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (project_id, app_id) DO UPDATE
          SET base_path=EXCLUDED.base_path, updated_at=NOW()
          RETURNING *
        `,
        [project_id, app_id, label, hostname, appBasePath(app_id), created_by],
      );
      row = result.rows[0];
      break;
    } catch (err: any) {
      if (err?.code !== "23505" || attempt === 4) {
        throw err;
      }
    }
  }
  if (!row) {
    throw new Error("unable to allocate a unique private app hostname");
  }

  let ensuredRecordId: string | undefined;
  try {
    const { record_id } = await ensureAppSubdomainDns({
      hostname: row.hostname,
      target_hostname: policy.dns_target,
      record_id: row.dns_record_id ?? undefined,
      adopt_existing: row.dns_record_id != null,
    });
    ensuredRecordId = record_id;
    const { rows } = await pool.query(
      `
        UPDATE ${TABLE}
        SET dns_record_id=$3,
            dns_target=$4,
            last_dns_error=NULL,
            updated_at=NOW()
        WHERE project_id=$1 AND app_id=$2
        RETURNING *
      `,
      [project_id, app_id, record_id, policy.dns_target],
    );
    if (!rows[0]) {
      throw new Error("private app hostname was released during reservation");
    }
    const reserved = mapRecord(rows[0]);
    hostCache.set(reserved.hostname, {
      project_id,
      app_id,
      base_path: reserved.base_path,
    });
    logger.info("private app hostname reserved", {
      project_id,
      app_id,
      hostname: reserved.hostname,
      created_by,
    });
    return reserved;
  } catch (err) {
    let recordedError: unknown = err;
    let orphanedRecordId: string | undefined;
    if (ensuredRecordId && ensuredRecordId !== row.dns_record_id) {
      try {
        await deleteAppSubdomainDns({
          record_id: ensuredRecordId,
          hostname: row.hostname,
        });
      } catch (cleanupErr) {
        orphanedRecordId = ensuredRecordId;
        recordedError = `${err}; compensating DNS deletion failed for record ${ensuredRecordId}: ${cleanupErr}`;
        logger.error("unable to compensate private app DNS creation", {
          project_id,
          app_id,
          hostname: row.hostname,
          dns_record_id: ensuredRecordId,
          err: `${cleanupErr}`,
        });
      }
    }
    await noteDnsError({
      project_id,
      app_id,
      error: recordedError,
      dns_record_id: orphanedRecordId,
    });
    throw err;
  }
}

export async function inspectProjectAppPrivateHostname(opts: {
  project_id: string;
  app_id: string;
}): Promise<ProjectAppPrivateHostnameRecord | undefined> {
  await ensureSchema();
  const project_id = `${opts.project_id ?? ""}`.trim();
  const app_id = normalizeAppId(opts.app_id);
  const { rows } = await getPool().query(
    `
      SELECT *
      FROM ${TABLE}
      WHERE project_id=$1 AND app_id=$2
      LIMIT 1
    `,
    [project_id, app_id],
  );
  return rows[0] ? mapRecord(rows[0]) : undefined;
}

export async function listProjectAppPrivateHostnames(opts: {
  project_id: string;
}): Promise<ProjectAppPrivateHostnameRecord[]> {
  await ensureSchema();
  const project_id = `${opts.project_id ?? ""}`.trim();
  const { rows } = await getPool().query(
    `
      SELECT *
      FROM ${TABLE}
      WHERE project_id=$1
      ORDER BY created_at, app_id
    `,
    [project_id],
  );
  return rows.map(mapRecord);
}

export async function releaseProjectAppPrivateHostname(opts: {
  project_id: string;
  app_id: string;
}): Promise<{ released: boolean }> {
  await ensureSchema();
  const project_id = `${opts.project_id ?? ""}`.trim();
  const app_id = normalizeAppId(opts.app_id);
  const current = await inspectProjectAppPrivateHostname({
    project_id,
    app_id,
  });
  if (!current) return { released: false };

  try {
    await deleteAppSubdomainDns({
      record_id: current.dns_record_id,
      hostname: current.hostname,
    });
  } catch (err) {
    await noteDnsError({ project_id, app_id, error: err });
    throw err;
  }
  const { rowCount } = await getPool().query(
    `
      DELETE FROM ${TABLE}
      WHERE project_id=$1 AND app_id=$2
    `,
    [project_id, app_id],
  );
  hostCache.delete(current.hostname);
  logger.info("private app hostname released", {
    project_id,
    app_id,
    hostname: current.hostname,
  });
  return { released: (rowCount ?? 0) > 0 };
}

export async function releaseProjectAppPrivateHostnamesForProject(opts: {
  project_id: string;
}): Promise<{ released: number }> {
  const records = await listProjectAppPrivateHostnames(opts);
  let released = 0;
  for (const record of records) {
    const result = await releaseProjectAppPrivateHostname({
      project_id: record.project_id,
      app_id: record.app_id,
    });
    if (result.released) released += 1;
  }
  return { released };
}

export async function reconcileProjectAppPrivateHostnamesForProject(opts: {
  project_id: string;
}): Promise<ReconcileProjectAppPrivateHostnamesResult> {
  const project_id = `${opts.project_id ?? ""}`.trim();
  const result: ReconcileProjectAppPrivateHostnamesResult = {
    project_id,
    checked: 0,
    updated: 0,
    errors: [],
  };
  // Placement changes are common. Avoid schema and DNS work on sites where the
  // feature has never been enabled.
  if (!(await privateHostnamesEnabled())) return result;

  const records = await listProjectAppPrivateHostnames({ project_id });
  result.checked = records.length;
  if (!records.length) return result;

  const policy = await getProjectAppPrivateHostnamePolicy(project_id);
  if (!policy.enabled || !policy.dns_target) {
    const error =
      policy.warnings[0] ?? "Private project app hostnames are unavailable.";
    for (const record of records) {
      await noteDnsError({
        project_id,
        app_id: record.app_id,
        error,
      });
      result.errors.push({ app_id: record.app_id, error });
    }
    return result;
  }

  try {
    const route = await getProjectHostPublicRoute(project_id);
    if (!route || route.hostname !== policy.host_hostname) {
      throw new Error(
        "The project host placement changed while reconciling its private app hostnames.",
      );
    }
    await ensureCloudflareProjectHostSslRule({
      hostname: route.hostname,
      host_id: route.host_id,
      zone_hostname: policy.site_hostname,
    });
  } catch (err) {
    const error = `${err}`;
    for (const record of records) {
      await noteDnsError({
        project_id,
        app_id: record.app_id,
        error,
      });
      result.errors.push({ app_id: record.app_id, error });
    }
    return result;
  }

  for (const record of records) {
    try {
      const { record_id } = await ensureAppSubdomainDns({
        hostname: record.hostname,
        target_hostname: policy.dns_target,
        record_id: record.dns_record_id,
        adopt_existing: record.dns_record_id != null,
      });
      await getPool().query(
        `
          UPDATE ${TABLE}
          SET dns_record_id=$3,
              dns_target=$4,
              last_dns_error=NULL,
              updated_at=NOW()
          WHERE project_id=$1 AND app_id=$2
        `,
        [project_id, record.app_id, record_id, policy.dns_target],
      );
      hostCache.delete(record.hostname);
      result.updated += 1;
    } catch (err) {
      const error = `${err}`;
      await noteDnsError({
        project_id,
        app_id: record.app_id,
        error,
      });
      result.errors.push({ app_id: record.app_id, error });
    }
  }
  logger.info("private app hostnames reconciled", result);
  return result;
}

export async function getPrivateAppRouteByHostname(
  hostnameRaw: string,
): Promise<PrivateAppRouteTarget | undefined> {
  if (!(await privateHostnamesEnabled())) return;
  await ensureSchema();
  const hostname = normalizeHostHeader(hostnameRaw);
  if (!hostname) return;
  if (hostCache.has(hostname)) {
    return hostCache.get(hostname) ?? undefined;
  }
  const { rows } = await getPool().query(
    `
      SELECT project_id, app_id, base_path
      FROM ${TABLE}
      WHERE LOWER(hostname)=LOWER($1)
      LIMIT 1
    `,
    [hostname],
  );
  const row = rows[0];
  const route = row
    ? {
        project_id: `${row.project_id}`,
        app_id: `${row.app_id}`,
        base_path: `${row.base_path}`,
      }
    : undefined;
  hostCache.set(hostname, route ?? null);
  return route;
}

export function clearPrivateAppHostnameCache(): void {
  hostCache.clear();
}
