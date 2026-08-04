/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { Client } from "@cocalc/conat/core/client";

let masterClient: Client | undefined;

export function getMasterConatClient(): Client | undefined {
  return masterClient;
}

export function setMasterConatClient(client: Client | undefined): void {
  masterClient = client;
}
