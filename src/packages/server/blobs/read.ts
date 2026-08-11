/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { isValidUUID } from "@cocalc/util/misc";

import { getBlobByteStore } from "./store";

export async function readBlobFromDatabase(
  uuid: string,
): Promise<Buffer | undefined> {
  if (!isValidUUID(uuid)) {
    throw Error("blob uuid is invalid");
  }
  return await getBlobByteStore().get(uuid);
}
