/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { db } from "@cocalc/database";
import { callback2 } from "@cocalc/util/async-utils";

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

class PostgreSQLBlobByteStore implements BlobByteStore {
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

let blobByteStore: BlobByteStore | undefined;

export function getBlobByteStore(): BlobByteStore {
  blobByteStore ??= new PostgreSQLBlobByteStore();
  return blobByteStore;
}

export function setBlobByteStoreForTesting(store: BlobByteStore | undefined) {
  blobByteStore = store;
}
