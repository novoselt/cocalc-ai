/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { db } from "@cocalc/database";
import getLogger from "@cocalc/backend/logger";
import {
  getR2ObjectBuffer,
  putR2ObjectFromBuffer,
  sha256Hex,
} from "@cocalc/backend/r2";
import { callback2 } from "@cocalc/util/async-utils";

import { resolveBlobStorageConfig } from "./config";
import { detectRasterImage, type RasterImageInfo } from "./media";

const logger = getLogger("server:blobs:store");

export interface PutBlobInput {
  uuid: string;
  blob: Buffer;
  ttl?: number;
  project_id?: string;
  account_id?: string;
}

export interface BlobByteStore {
  get(uuid: string): Promise<Buffer | undefined>;
  put(input: PutBlobInput): Promise<void>;
}

export class PostgreSQLBlobByteStore implements BlobByteStore {
  async get(uuid: string): Promise<Buffer | undefined> {
    const blob = await callback2(db().get_blob, { uuid });
    if (blob == null) {
      return undefined;
    }
    return Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  }

  async put({
    uuid,
    blob,
    ttl,
    project_id,
    account_id,
  }: PutBlobInput): Promise<void> {
    const database = db();
    await callback2(database.save_blob.bind(database), {
      uuid,
      blob,
      ttl,
      project_id,
      account_id,
    });
  }
}

export function blobR2Key(uuid: string): string {
  return `blobs/v1/${uuid.replace(/-/g, "").slice(0, 2)}/${uuid}`;
}

class R2BlobByteStore implements BlobByteStore {
  constructor(private readonly postgres: PostgreSQLBlobByteStore) {}

  async get(uuid: string): Promise<Buffer | undefined> {
    const config = await resolveBlobStorageConfig();
    if (config.activeBackend !== "r2" || !config.r2) {
      return await this.postgres.get(uuid);
    }
    const r2Blob = await getR2ObjectBuffer({
      auth: config.r2.auth,
      key: blobR2Key(uuid),
    });
    if (r2Blob != null) {
      return r2Blob;
    }
    return await this.postgres.get(uuid);
  }

  async put(input: PutBlobInput): Promise<void> {
    await this.postgres.put(input);

    const config = await resolveBlobStorageConfig();
    if (config.activeBackend !== "r2" || !config.r2) {
      return;
    }

    const media = detectRasterImage(input.blob);
    if (!media) {
      logger.debug(
        "leaving non-raster blob in PostgreSQL compatibility store",
        {
          uuid: input.uuid,
          size: input.blob.length,
        },
      );
      return;
    }
    await putImageBlobToR2({
      uuid: input.uuid,
      blob: input.blob,
      media,
    });
  }
}

export async function putImageBlobToR2({
  uuid,
  blob,
  media,
  source = "upload",
}: {
  uuid: string;
  blob: Buffer;
  media: RasterImageInfo;
  source?: string;
}): Promise<"created" | "already-exists"> {
  const config = await resolveBlobStorageConfig();
  if (config.activeBackend !== "r2" || !config.r2) {
    throw new Error("R2 blob storage is not configured");
  }
  const key = blobR2Key(uuid);
  const existing = await getR2ObjectBuffer({ auth: config.r2.auth, key });
  if (existing != null) {
    if (existing.equals(blob)) {
      return "already-exists";
    }
    throw new Error(`R2 blob ${uuid} already exists with different bytes`);
  }
  await putR2ObjectFromBuffer({
    auth: config.r2.auth,
    key,
    body: blob,
    contentType: media.contentType,
    cacheControl: "public, max-age=31536000, immutable",
    metadata: {
      "cocalc-sha256": sha256Hex(blob),
      "cocalc-size": `${blob.length}`,
      "cocalc-media-type": media.contentType,
      "cocalc-source": source,
      "cocalc-version": "1",
      "cocalc-imported-at": new Date().toISOString(),
    },
  });
  return "created";
}

let blobByteStore: BlobByteStore | undefined;

export function getBlobByteStore(): BlobByteStore {
  blobByteStore ??= new R2BlobByteStore(new PostgreSQLBlobByteStore());
  return blobByteStore;
}

export function setBlobByteStoreForTesting(store: BlobByteStore | undefined) {
  blobByteStore = store;
}
