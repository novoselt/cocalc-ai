/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { HostPodmanSnapshotResponse } from "@cocalc/conat/project-host/api";

const DEFAULT_CACHE_TTL_MS = 60_000;

type CapturePodmanSnapshot = (
  limit: number,
) => Promise<HostPodmanSnapshotResponse>;

export function createCachedPodmanSnapshotReader({
  capture,
  runRuntimeDiagnostic,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = Date.now,
}: {
  capture: CapturePodmanSnapshot;
  runRuntimeDiagnostic: <T>(fn: () => Promise<T>) => Promise<T>;
  cacheTtlMs?: number;
  now?: () => number;
}) {
  const cache = new Map<
    number,
    { capturedAtMs: number; response: HostPodmanSnapshotResponse }
  >();
  const inflight = new Map<number, Promise<HostPodmanSnapshotResponse>>();
  let serial = Promise.resolve();

  const cachedResponse = (
    entry: { capturedAtMs: number; response: HostPodmanSnapshotResponse },
    cached: boolean,
  ): HostPodmanSnapshotResponse => ({
    ...entry.response,
    cached,
    cache_age_ms: Math.max(0, now() - entry.capturedAtMs),
  });

  return async (limit: number): Promise<HostPodmanSnapshotResponse> => {
    const existing = cache.get(limit);
    if (existing && now() - existing.capturedAtMs <= cacheTtlMs) {
      return cachedResponse(existing, true);
    }

    const active = inflight.get(limit);
    if (active) {
      const response = await active;
      return { ...response, cached: true };
    }

    const preceding = serial;
    const request = (async () => {
      await preceding;
      const refreshed = cache.get(limit);
      if (refreshed && now() - refreshed.capturedAtMs <= cacheTtlMs) {
        return cachedResponse(refreshed, true);
      }
      const capturedAtMs = now();
      const response = await runRuntimeDiagnostic(() => capture(limit));
      const captured: HostPodmanSnapshotResponse = {
        ...response,
        captured_at: new Date(capturedAtMs).toISOString(),
        cache_age_ms: Math.max(0, now() - capturedAtMs),
        cached: false,
      };
      cache.set(limit, { capturedAtMs, response: captured });
      return captured;
    })();
    inflight.set(limit, request);
    serial = request.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await request;
    } finally {
      if (inflight.get(limit) === request) {
        inflight.delete(limit);
      }
    }
  };
}
