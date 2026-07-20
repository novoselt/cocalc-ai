/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { db } from "@cocalc/database";
import { callback2 } from "@cocalc/util/async-utils";
import { isValidUUID } from "@cocalc/util/misc";

export async function readBlobFromDatabase(
  uuid: string,
): Promise<Buffer | undefined> {
  if (!isValidUUID(uuid)) {
    throw Error("blob uuid is invalid");
  }
  const blob = await callback2(db().get_blob, { uuid });
  if (blob == null) {
    return;
  }
  return Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
}
