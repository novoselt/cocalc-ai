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

function sendUxLatencyEvent(event: UxLatencyEventInput): void {
  try {
    const record =
      webapp_client.conat_client?.hub?.system?.recordUxLatencyEvent;
    if (typeof record !== "function") {
      return;
    }
    void record({ event }).catch(() => {
      // Telemetry must never affect the user-visible action being measured.
    });
  } catch {
    // Telemetry must never affect the user-visible action being measured.
  }
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
    const events = pendingEvents;
    pendingEvents = [];
    if (enabled) {
      for (const event of events) {
        sendUxLatencyEvent(event);
      }
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
  configured = false;
  enabled = false;
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
    if (pendingEvents.length < MAX_PENDING_EVENTS) {
      pendingEvents.push(event);
    }
    return;
  }
  if (!enabled) return;
  sendUxLatencyEvent(event);
}
