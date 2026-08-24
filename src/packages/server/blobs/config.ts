/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { R2ObjectStoreAuth } from "@cocalc/backend/r2";
import { getServerSettings } from "@cocalc/database/settings/server-settings";

export type BlobStorageBackend = "postgres" | "r2" | "auto";

export interface BlobStorageConfig {
  backend: BlobStorageBackend;
  activeBackend: "postgres" | "r2";
  r2?: {
    auth: R2ObjectStoreAuth;
    publicBaseUrl?: string;
  };
}

function trim(value: unknown): string {
  return `${value ?? ""}`.trim();
}

function env(name: string): string {
  return trim(process.env[name]);
}

function normalizeBackend(value: unknown): BlobStorageBackend {
  const backend = trim(value).toLowerCase();
  if (backend === "r2" || backend === "auto" || backend === "postgres") {
    return backend;
  }
  return "postgres";
}

function normalizedPublicBaseUrl(value: unknown): string | undefined {
  const raw = trim(value);
  if (!raw) return undefined;
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:") {
    throw new Error("blob_r2_public_url must use https");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

export async function resolveBlobStorageConfig(): Promise<BlobStorageConfig> {
  const envBackend = env("COCALC_BLOB_STORAGE_BACKEND");
  const envAccountId = env("COCALC_BLOB_R2_ACCOUNT_ID");
  const envEndpoint =
    env("COCALC_BLOB_R2_ENDPOINT") ||
    (envAccountId ? `https://${envAccountId}.r2.cloudflarestorage.com` : "");
  const envAccessKey = env("COCALC_BLOB_R2_ACCESS_KEY_ID");
  const envSecretKey = env("COCALC_BLOB_R2_SECRET_ACCESS_KEY");
  const envBucket = env("COCALC_BLOB_R2_BUCKET");
  if (envBackend) {
    const backend = normalizeBackend(envBackend);
    const publicBaseUrl = normalizedPublicBaseUrl(
      env("COCALC_BLOB_R2_PUBLIC_URL"),
    );
    const r2Configured = !!(
      envEndpoint &&
      envAccessKey &&
      envSecretKey &&
      envBucket
    );
    if (backend === "r2" && !r2Configured) {
      throw new Error(
        "COCALC_BLOB_STORAGE_BACKEND is r2 but R2 endpoint, credentials, or blob bucket are not configured",
      );
    }
    if (backend === "postgres" || !r2Configured) {
      return { backend, activeBackend: "postgres" };
    }
    return {
      backend,
      activeBackend: "r2",
      r2: {
        auth: {
          endpoint: envEndpoint,
          accessKey: envAccessKey,
          secretKey: envSecretKey,
          bucket: envBucket,
          region: env("COCALC_BLOB_R2_REGION") || undefined,
        },
        publicBaseUrl,
      },
    };
  }

  const settings = await getServerSettings();
  const backend = normalizeBackend(settings.blob_storage_backend);
  const accountId =
    env("COCALC_BLOB_R2_ACCOUNT_ID") || trim(settings.r2_account_id);
  const endpoint =
    env("COCALC_BLOB_R2_ENDPOINT") ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const accessKey =
    env("COCALC_BLOB_R2_ACCESS_KEY_ID") || trim(settings.r2_access_key_id);
  const secretKey =
    env("COCALC_BLOB_R2_SECRET_ACCESS_KEY") ||
    trim(settings.r2_secret_access_key);
  const bucket =
    env("COCALC_BLOB_R2_BUCKET") ||
    trim(settings.blob_r2_bucket) ||
    (trim(settings.r2_bucket_prefix)
      ? `${trim(settings.r2_bucket_prefix)}-blobs`
      : "");
  const publicBaseUrl = normalizedPublicBaseUrl(
    env("COCALC_BLOB_R2_PUBLIC_URL") || settings.blob_r2_public_url,
  );

  const r2Configured = !!(endpoint && accessKey && secretKey && bucket);
  if (backend === "r2" && !r2Configured) {
    throw new Error(
      "blob_storage_backend is r2 but R2 endpoint, credentials, or blob bucket are not configured",
    );
  }
  if (backend === "postgres" || !r2Configured) {
    return { backend, activeBackend: "postgres" };
  }

  return {
    backend,
    activeBackend: "r2",
    r2: {
      auth: {
        endpoint,
        accessKey,
        secretKey,
        bucket,
        region: env("COCALC_BLOB_R2_REGION") || undefined,
      },
      publicBaseUrl,
    },
  };
}

export async function getBlobPublicUrl(
  uuid: string,
): Promise<string | undefined> {
  const config = await resolveBlobStorageConfig();
  if (config.activeBackend !== "r2" || !config.r2?.publicBaseUrl) {
    return undefined;
  }
  return `${config.r2.publicBaseUrl}/${uuid}`;
}
