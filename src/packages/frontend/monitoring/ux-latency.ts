/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { webapp_client } from "@cocalc/frontend/webapp-client";
import type { UxLatencyEventInput } from "@cocalc/conat/hub/api/system";

const DEFAULT_LIGHTWEIGHT_SUCCESS_SAMPLE_RATE = 0.25;
const MAX_PENDING_EVENTS = 32;

let configured = false;
let enabled = false;
let lightweightSuccessSampleRate = DEFAULT_LIGHTWEIGHT_SUCCESS_SAMPLE_RATE;
let pendingEvents: UxLatencyEventInput[] = [];
let sending = false;
let sendGeneration = 0;

function enqueueUxLatencyEvent(event: UxLatencyEventInput): void {
  if (pendingEvents.length >= MAX_PENDING_EVENTS) return;
  pendingEvents.push(event);
  drainUxLatencyEvents();
}

function drainUxLatencyEvents(): void {
  if (!enabled || sending || pendingEvents.length === 0) return;
  const generation = sendGeneration;
  sending = true;
  void (async () => {
    while (
      enabled &&
      generation === sendGeneration &&
      pendingEvents.length > 0
    ) {
      const event = pendingEvents.shift()!;
      try {
        const record =
          webapp_client.conat_client?.hub?.system?.recordUxLatencyEvent;
        if (typeof record !== "function") continue;
        // Serialize best-effort telemetry so reconnects and slow hubs cannot
        // turn measurements into a request storm that delays user work.
        await record({ event });
      } catch {
        // Telemetry must never affect the user-visible action being measured.
      }
    }
  })().finally(() => {
    if (generation !== sendGeneration) return;
    sending = false;
    drainUxLatencyEvents();
  });
}

export function configureUxLatency({
  telemetry_enabled,
  success_sample_rate,
}: {
  telemetry_enabled?: boolean;
  success_sample_rate?: number | null;
}): void {
  if (typeof telemetry_enabled === "boolean") {
    configured = true;
    enabled = telemetry_enabled;
    if (enabled) {
      drainUxLatencyEvents();
    } else {
      pendingEvents = [];
    }
  }
  const rate =
    success_sample_rate == null ? undefined : Number(success_sample_rate);
  if (rate != null && Number.isFinite(rate)) {
    lightweightSuccessSampleRate = Math.min(1, Math.max(0, rate));
  }
}

export function getLightweightUxSuccessSampleRate(): number {
  return lightweightSuccessSampleRate;
}

export function resetUxLatencyConfigurationForTests(): void {
  sendGeneration += 1;
  configured = false;
  enabled = false;
  sending = false;
  lightweightSuccessSampleRate = DEFAULT_LIGHTWEIGHT_SUCCESS_SAMPLE_RATE;
  pendingEvents = [];
}

export function startUxTimer(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function elapsedUxMs(start: number): number {
  const now = globalThis.performance?.now?.() ?? Date.now();
  return Math.max(0, Math.round(now - start));
}

export function recordUxLatencyEvent(event: UxLatencyEventInput): void {
  if (!configured) {
    if (pendingEvents.length < MAX_PENDING_EVENTS) pendingEvents.push(event);
    return;
  }
  if (!enabled) return;
  enqueueUxLatencyEvent(event);
}
