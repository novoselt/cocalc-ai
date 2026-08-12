/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { ImmerDB, ImmerDBOptions } from "./immer-db";
import type { SyncDB, SyncDBOptions } from "./syncdb";
import type { SyncString, SyncStringOptions } from "./syncstring";

export interface SyncDocFactories {
  string: (opts: SyncStringOptions) => SyncString;
  db: (opts: SyncDBOptions) => SyncDB;
  immer: (opts: ImmerDBOptions) => ImmerDB;
}

let factories: SyncDocFactories | undefined;
let loader: (() => Promise<void>) | undefined;
let loadPromise: Promise<void> | undefined;

export function registerSyncDocFactories(next: SyncDocFactories): void {
  factories = next;
}

export function registerSyncDocLoader(next: () => Promise<void>): void {
  loader = next;
}

export async function ensureSyncDocFactories(): Promise<void> {
  if (factories != null) return;
  if (loader == null) {
    throw Error("SyncDoc capability loader is not registered");
  }
  loadPromise ??= loader().catch((err) => {
    loadPromise = undefined;
    throw err;
  });
  await loadPromise;
  getSyncDocFactories();
}

export function getSyncDocFactories(): SyncDocFactories {
  if (factories == null) {
    throw Error(
      "SyncDoc capability is not installed; import @cocalc/conat/sync-doc/install before constructing a SyncDoc",
    );
  }
  return factories;
}
