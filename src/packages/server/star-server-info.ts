/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { StarServerInfo } from "@cocalc/conat/hub/api/system";
import { readFile, readlink } from "node:fs/promises";
import { arch, hostname, platform, release as osRelease } from "node:os";

export const STAR_INSTALL_ROOT = "/opt/cocalc-star";

async function readJsonFile(path: string): Promise<Record<string, any>> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function parseStarChannelEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1);
    if (/^COCALC_STAR_[A-Z0-9_]+$/.test(key)) {
      env[key] = value;
    }
  }
  return env;
}

async function readlinkBestEffort(path: string): Promise<string | undefined> {
  try {
    return await readlink(path);
  } catch {
    return undefined;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Read deployed Star identity without imposing an authorization policy. */
export async function readStarServerInfo(
  installRoot = STAR_INSTALL_ROOT,
): Promise<StarServerInfo> {
  const installMetadata = await readJsonFile(
    `${installRoot}/current/release.json`,
  );
  const buildMetadata = {
    ...(await readJsonFile(`${installRoot}/current/source/release.json`)),
    ...(await readJsonFile(`${installRoot}/current/build-release.json`)),
  };
  const channelEnv = parseStarChannelEnv(
    await readTextFile(`${installRoot}/channel.env`),
  );
  const releaseId =
    optionalString(installMetadata.release_id) ??
    optionalString(buildMetadata.release_id);

  return {
    detected: !!releaseId || !!optionalString(buildMetadata.product),
    checked_at: new Date().toISOString(),
    product: optionalString(buildMetadata.product) ?? "cocalc-star",
    channel: optionalString(channelEnv.COCALC_STAR_CHANNEL),
    release_id: releaseId,
    release_base_url: optionalString(channelEnv.COCALC_STAR_RELEASE_BASE_URL),
    promoted_at: optionalString(channelEnv.COCALC_STAR_PROMOTED_AT),
    git_revision:
      optionalString(channelEnv.COCALC_STAR_GIT_REVISION) ??
      optionalString(buildMetadata.git_revision),
    git_dirty: optionalBoolean(buildMetadata.git_dirty),
    artifact_mode: optionalString(buildMetadata.artifact_mode),
    payload_kind: optionalString(buildMetadata.payload_kind),
    payload_sha256: optionalString(buildMetadata.payload_sha256),
    built_at: optionalString(buildMetadata.built_at),
    installed_at: optionalString(installMetadata.installed_at),
    tarball_sha256: optionalString(installMetadata.tarball_sha256),
    install_root: installRoot,
    current_release_path: await readlinkBestEffort(`${installRoot}/current`),
    source_path:
      optionalString(installMetadata.source_path) ??
      (await readlinkBestEffort(`${installRoot}/source`)),
    hostname: hostname(),
    architecture: arch(),
    platform: platform(),
    os_release: osRelease(),
  };
}
