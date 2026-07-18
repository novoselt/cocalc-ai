/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type {
  PersistMaintenanceClose,
  PersistMaintenancePath,
  PersistMaintenanceUse,
} from "./types";

export type PersistMaintenanceWorkerEvent =
  | {
      type: "register";
      workerId: string;
      ownerId: string;
      pid: number;
      processStartToken: string;
    }
  | { type: "begin-open"; requestId: string; use: PersistMaintenanceUse }
  | {
      type: "open-failed";
      use: PersistMaintenanceUse;
      error: string;
    }
  | { type: "mutation"; use: PersistMaintenanceUse }
  | { type: "closed"; close: PersistMaintenanceClose }
  | { type: "tracking-unavailable"; workerId: string; error: string };

export type PersistMaintenanceCoordinatorEvent =
  | { type: "registered"; workerId: string }
  | { type: "begin-open-ack"; requestId: string; ok: true }
  | {
      type: "begin-open-ack";
      requestId: string;
      ok: false;
      error: string;
    };

export interface PersistMaintenanceTracker {
  beginOpen(path: PersistMaintenancePath): Promise<PersistMaintenanceUse>;
  openFailed(use: PersistMaintenanceUse, error: unknown): void;
  mutation(use: PersistMaintenanceUse): void;
  closed(close: PersistMaintenanceClose): void;
  trackingUnavailable(error: unknown): void;
  close(): void;
}
