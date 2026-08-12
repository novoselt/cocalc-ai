/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { immerdb } from "./immer-db";
import { registerSyncDocFactories } from "./factories";
import { syncdb } from "./syncdb";
import { syncstring } from "./syncstring";

registerSyncDocFactories({
  string: syncstring,
  db: syncdb,
  immer: immerdb,
});
