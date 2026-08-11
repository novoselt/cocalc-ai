/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  afterNextPaint,
  UxLatencyTrace,
  type UxTraceStart,
} from "@cocalc/frontend/monitoring/ux-latency-trace";

let trace: UxLatencyTrace | undefined;
let recorded = false;
const entrySurface =
  typeof window !== "undefined" && window.location.pathname.includes("/auth/")
    ? "auth"
    : "application";

function navigationEntry(): PerformanceNavigationTiming | undefined {
  if (typeof performance === "undefined") return;
  return performance.getEntriesByType?.("navigation")?.[0] as
    | PerformanceNavigationTiming
    | undefined;
}

function navigationStart(): UxTraceStart | undefined {
  if (typeof performance === "undefined") return;
  const wall = Number(performance.timeOrigin);
  if (!Number.isFinite(wall) || wall <= 0) return;
  return {
    wall_ms: wall,
    ux_ms: 0,
    page_hidden: typeof document !== "undefined" && document.hidden,
    visibility_epoch: 0,
  };
}

function getTrace(): UxLatencyTrace {
  if (trace != null) return trace;
  const navigation = navigationEntry();
  trace = new UxLatencyTrace({
    event_type: "app_bootstrap",
    source: "document_navigation",
    surface_visible: true,
    stale_after_ms: 120_000,
    start: navigationStart(),
  });
  markNavigationPhases(trace, navigation);
  trace.mark("bootstrap_module_loaded");
  return trace;
}

function markNavigationPhases(
  target: UxLatencyTrace,
  navigation = navigationEntry(),
): void {
  if (typeof performance === "undefined") return;
  const phases: Array<[string, number | undefined]> = [
    ["dns_done", navigation?.domainLookupEnd],
    ["connect_done", navigation?.connectEnd],
    ["request_started", navigation?.requestStart],
    ["response_started", navigation?.responseStart],
    ["response_done", navigation?.responseEnd],
    ["dom_interactive", navigation?.domInteractive],
    ["dom_content_loaded", navigation?.domContentLoadedEventEnd],
    ["window_loaded", navigation?.loadEventEnd],
  ];
  for (const [phase, elapsed] of phases) {
    if (typeof elapsed === "number" && elapsed > 0) {
      target.markAt(phase, elapsed);
    }
  }
  for (const paint of performance.getEntriesByType?.("paint") ?? []) {
    if (
      paint.name === "first-paint" ||
      paint.name === "first-contentful-paint"
    ) {
      target.markAt(paint.name.replace(/-/g, "_"), paint.startTime);
    }
  }
}

export function markAppBootstrapPhase(phase: string): void {
  if (recorded) return;
  getTrace().mark(phase);
}

function connectionDetails(): Record<string, unknown> {
  if (typeof navigator === "undefined") return {};
  const connection = (navigator as any).connection;
  return {
    effective_connection_type:
      typeof connection?.effectiveType === "string"
        ? connection.effectiveType
        : undefined,
    save_data: connection?.saveData === true,
    rtt_ms: Number.isFinite(connection?.rtt) ? connection.rtt : undefined,
    downlink_mbps: Number.isFinite(connection?.downlink)
      ? connection.downlink
      : undefined,
    device_memory_gb: Number.isFinite((navigator as any)?.deviceMemory)
      ? (navigator as any).deviceMemory
      : undefined,
    hardware_concurrency: Number.isFinite(navigator?.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : undefined,
  };
}

function timingDetails(): Record<string, unknown> {
  const navigation = navigationEntry();
  const resources = (performance.getEntriesByType?.("resource") ??
    []) as PerformanceResourceTiming[];
  const resourceSummary = (initiatorType: string) => {
    const selected = resources.filter(
      (entry) => entry.initiatorType === initiatorType,
    );
    return {
      count: selected.length,
      transfer_size: selected.reduce(
        (total, entry) => total + (entry.transferSize ?? 0),
        0,
      ),
      encoded_body_size: selected.reduce(
        (total, entry) => total + (entry.encodedBodySize ?? 0),
        0,
      ),
      cache_hits: selected.filter(
        (entry) => entry.transferSize === 0 && entry.decodedBodySize > 0,
      ).length,
      last_response_end_ms: selected.reduce(
        (latest, entry) => Math.max(latest, entry.responseEnd ?? 0),
        0,
      ),
    };
  };
  return {
    navigation_type: navigation?.type,
    protocol: navigation?.nextHopProtocol,
    transfer_size: navigation?.transferSize,
    encoded_body_size: navigation?.encodedBodySize,
    decoded_body_size: navigation?.decodedBodySize,
    redirect_count: navigation?.redirectCount,
    entry_surface: entrySurface,
    scripts: resourceSummary("script"),
    stylesheets: resourceSummary("link"),
    ...connectionDetails(),
  };
}

export function recordSignedInAppBootstrapReady(): () => void {
  if (recorded) return () => {};
  const current = getTrace();
  current.mark("account_and_site_ready");
  return afterNextPaint(() => {
    if (recorded) return;
    recorded = true;
    markNavigationPhases(current);
    current.record("signed_in_app_ready_v2", {
      segment: `${navigationEntry()?.type ?? "unknown"}:${entrySurface}`,
      surface_visible: true,
      details: {
        ...timingDetails(),
        paint_observer: "react_commit_next_animation_frame",
      },
    });
  });
}

export function recordAppBootstrapFailed(
  phase: string,
  errorName: string,
): void {
  if (recorded) return;
  recorded = true;
  getTrace().record("app_bootstrap_failed_v2", {
    surface_visible: true,
    details: { phase, error_name: errorName },
  });
}
