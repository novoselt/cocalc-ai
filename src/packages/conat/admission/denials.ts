/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getLogger } from "@cocalc/conat/logger";
import { getServiceAdmissionNearLimitConfig } from "./limits";

const logger = getLogger("conat:admission:denials");

export interface ServiceAdmissionDenialEvent {
  surface: string;
  limit: string;
  current: number;
  maximum: number;
  count?: number;
  suppressed_count?: number;
  source?: string;
  reason?: string;
  host_id?: string;
  account_id?: string;
  project_id?: string;
  browser_id?: string;
  socket_id?: string;
  subject?: string;
  path?: string;
  key?: string;
  time?: number;
  first_time?: number;
  last_time?: number;
}

type ServiceAdmissionDenialRecorder = (
  event: ServiceAdmissionDenialEvent,
) => void | Promise<void>;

let serviceAdmissionDenialRecorder: ServiceAdmissionDenialRecorder | undefined;
let serviceAdmissionNearLimitRecorder:
  | ServiceAdmissionDenialRecorder
  | undefined;
const nearLimitLastRecorded = new Map<string, number>();

type PendingDenialBatch = {
  event: ServiceAdmissionDenialEvent;
  count: number;
  firstTime: number;
  lastTime: number;
  maxCurrent: number;
  maxMaximum: number;
  timer: ReturnType<typeof setTimeout>;
};

const pendingDenialBatches = new Map<string, PendingDenialBatch>();

const DEFAULT_DENIAL_AGGREGATE_MS = 10_000;
const MIN_DENIAL_AGGREGATE_MS = 1_000;

function denialAggregateIntervalMs(): number {
  const value = Number(
    process.env.COCALC_SERVICE_ADMISSION_DENIAL_AGGREGATE_MS,
  );
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_DENIAL_AGGREGATE_MS;
  }
  return Math.max(MIN_DENIAL_AGGREGATE_MS, Math.floor(value));
}

export function setServiceAdmissionDenialRecorder(
  recorder?: ServiceAdmissionDenialRecorder,
): void {
  clearPendingServiceAdmissionDenials();
  serviceAdmissionDenialRecorder = recorder;
}

export function setServiceAdmissionNearLimitRecorder(
  recorder?: ServiceAdmissionDenialRecorder,
): void {
  serviceAdmissionNearLimitRecorder = recorder;
}

function nonnegativeInteger(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  const number = nonnegativeInteger(value);
  return number > 0 ? number : undefined;
}

function optionalNonnegativeInteger(value: unknown): number | undefined {
  if (value == null) return undefined;
  return nonnegativeInteger(value);
}

function optionalTime(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function normalizeServiceAdmissionDenialEvent(
  event: ServiceAdmissionDenialEvent,
): ServiceAdmissionDenialEvent {
  const time =
    typeof event.time === "number" && Number.isFinite(event.time)
      ? event.time
      : Date.now();
  return {
    ...event,
    surface: `${event.surface ?? ""}`.trim() || "unknown",
    limit: `${event.limit ?? ""}`.trim() || "unknown",
    current: nonnegativeInteger(event.current),
    maximum: nonnegativeInteger(event.maximum),
    count: optionalPositiveInteger(event.count),
    suppressed_count: optionalNonnegativeInteger(event.suppressed_count),
    source: `${event.source ?? ""}`.trim() || "unknown",
    time,
    first_time: optionalTime(event.first_time),
    last_time: optionalTime(event.last_time),
  };
}

function admissionDenialKey(event: ServiceAdmissionDenialEvent): string {
  return [
    event.surface,
    event.limit,
    event.source,
    event.host_id,
    event.account_id,
    event.project_id,
    event.browser_id,
    event.socket_id,
    event.subject,
    event.path,
    event.key,
    event.reason,
  ]
    .map((value) => `${value ?? ""}`)
    .join("\n");
}

function recordDenialWithRecorder(
  recorder: ServiceAdmissionDenialRecorder,
  event: ServiceAdmissionDenialEvent,
): Promise<void> {
  const normalized = normalizeServiceAdmissionDenialEvent(event);
  return Promise.resolve()
    .then(() => recorder(normalized))
    .catch((err) => {
      logger.warn("failed to record service admission denial", {
        err: `${err}`,
        surface: normalized.surface,
        limit: normalized.limit,
        source: normalized.source,
      });
    });
}

function clearPendingServiceAdmissionDenials(): void {
  for (const batch of pendingDenialBatches.values()) {
    clearTimeout(batch.timer);
  }
  pendingDenialBatches.clear();
}

async function flushAdmissionDenialBatch(key: string): Promise<void> {
  const batch = pendingDenialBatches.get(key);
  if (batch == null) return;
  clearTimeout(batch.timer);
  pendingDenialBatches.delete(key);
  if (batch.count <= 0) return;
  const recorder = serviceAdmissionDenialRecorder;
  if (recorder == null) return;
  await recordDenialWithRecorder(recorder, {
    ...batch.event,
    current: batch.maxCurrent,
    maximum: batch.maxMaximum,
    count: batch.count,
    suppressed_count: batch.count,
    first_time: batch.firstTime,
    last_time: batch.lastTime,
    time: batch.lastTime,
  });
}

export async function flushServiceAdmissionDenialsForTests(): Promise<void> {
  await Promise.all(
    Array.from(pendingDenialBatches.keys()).map(flushAdmissionDenialBatch),
  );
}

export function resetServiceAdmissionDenialsForTests(): void {
  clearPendingServiceAdmissionDenials();
  serviceAdmissionDenialRecorder = undefined;
  serviceAdmissionNearLimitRecorder = undefined;
  nearLimitLastRecorded.clear();
}

export function recordServiceAdmissionDenial(
  event: ServiceAdmissionDenialEvent,
): void {
  const recorder = serviceAdmissionDenialRecorder;
  if (recorder == null) {
    return;
  }
  const normalized = normalizeServiceAdmissionDenialEvent(event);
  const time = normalized.time ?? Date.now();
  const key = admissionDenialKey(normalized);
  const batch = pendingDenialBatches.get(key);
  const eventCount = normalized.count ?? 1;
  if (batch != null) {
    if (batch.count === 0) {
      batch.firstTime = time;
    }
    batch.count += eventCount;
    batch.lastTime = time;
    batch.maxCurrent = Math.max(batch.maxCurrent, normalized.current);
    batch.maxMaximum = Math.max(batch.maxMaximum, normalized.maximum);
    batch.event = normalized;
    return;
  }

  void recordDenialWithRecorder(recorder, {
    ...normalized,
    count: normalized.count ?? 1,
    suppressed_count: normalized.suppressed_count ?? 0,
    first_time: normalized.first_time ?? time,
    last_time: normalized.last_time ?? time,
    time,
  });

  const timer = setTimeout(() => {
    void flushAdmissionDenialBatch(key);
  }, denialAggregateIntervalMs());
  timer.unref?.();
  pendingDenialBatches.set(key, {
    event: normalized,
    count: 0,
    firstTime: time,
    lastTime: time,
    maxCurrent: normalized.current,
    maxMaximum: normalized.maximum,
    timer,
  });
}

function nearLimitThrottleKey(event: ServiceAdmissionDenialEvent): string {
  return [
    event.surface,
    event.limit,
    event.source,
    event.host_id,
    event.account_id,
    event.project_id,
    event.subject,
    event.path,
    event.key,
  ]
    .map((value) => `${value ?? ""}`)
    .join("\n");
}

export function recordServiceAdmissionNearLimit(
  event: ServiceAdmissionDenialEvent,
): void {
  const recorder = serviceAdmissionNearLimitRecorder;
  if (recorder == null) {
    return;
  }
  const normalized = normalizeServiceAdmissionDenialEvent(event);
  const { thresholdPercent, logIntervalMs } =
    getServiceAdmissionNearLimitConfig();
  if (
    normalized.maximum <= 0 ||
    normalized.current * 100 < normalized.maximum * thresholdPercent
  ) {
    return;
  }
  const key = nearLimitThrottleKey(normalized);
  const lastRecorded = nearLimitLastRecorded.get(key) ?? 0;
  if (normalized.time! - lastRecorded < logIntervalMs) {
    return;
  }
  nearLimitLastRecorded.set(key, normalized.time!);
  void Promise.resolve()
    .then(() => recorder(normalized))
    .catch((err) => {
      logger.warn("failed to record service admission near-limit event", {
        err: `${err}`,
        surface: normalized.surface,
        limit: normalized.limit,
        source: normalized.source,
      });
    });
}
