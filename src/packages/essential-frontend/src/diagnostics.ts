/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

const MAX_EVENTS = 200;
const MAX_TEXT_LENGTH = 160;

export type EssentialDiagnosticValue = string | number | boolean | null;

export interface EssentialDiagnosticEvent {
  at: string;
  details?: Record<string, EssentialDiagnosticValue>;
  event: string;
  sequence: number;
  surface: string;
}

export interface EssentialDiagnosticsSnapshot {
  captured_at: string;
  events: EssentialDiagnosticEvent[];
  version: 1;
}

interface EssentialDiagnosticsApi {
  snapshot: () => EssentialDiagnosticsSnapshot;
}

declare global {
  interface Window {
    __COCALC_ESSENTIAL_DIAGNOSTICS__?: EssentialDiagnosticsApi;
  }
}

const events: EssentialDiagnosticEvent[] = [];
let sequence = 0;

function bounded(value: EssentialDiagnosticValue): EssentialDiagnosticValue {
  if (typeof value !== "string" || value.length <= MAX_TEXT_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_TEXT_LENGTH - 3)}...`;
}

function boundedString(value: string): string {
  return bounded(value) as string;
}

function sanitizeDetails(
  details?: Record<string, EssentialDiagnosticValue | undefined>,
): Record<string, EssentialDiagnosticValue> | undefined {
  if (!details) return;
  const safe: Record<string, EssentialDiagnosticValue> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue;
    safe[key] = bounded(value);
  }
  return Object.keys(safe).length ? safe : undefined;
}

export function recordEssentialDiagnostic(
  surface: string,
  event: string,
  details?: Record<string, EssentialDiagnosticValue | undefined>,
): void {
  events.push({
    at: new Date().toISOString(),
    details: sanitizeDetails(details),
    event: boundedString(event),
    sequence: ++sequence,
    surface: boundedString(surface),
  });
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

export function essentialDiagnosticsSnapshot(): EssentialDiagnosticsSnapshot {
  return {
    captured_at: new Date().toISOString(),
    events: events.map((entry) => ({
      ...entry,
      details: entry.details ? { ...entry.details } : undefined,
    })),
    version: 1,
  };
}

export function essentialDiagnosticErrorDetails(
  error: unknown,
): Record<string, EssentialDiagnosticValue> {
  if (!(error instanceof Error)) return { error_type: typeof error };
  const code = (error as Error & { code?: unknown }).code;
  return {
    error_name: error.name,
    error_code:
      typeof code === "string" || typeof code === "number" ? `${code}` : null,
  };
}

if (typeof window !== "undefined") {
  window.__COCALC_ESSENTIAL_DIAGNOSTICS__ = {
    snapshot: essentialDiagnosticsSnapshot,
  };
}
