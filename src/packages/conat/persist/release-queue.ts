/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export const DEFAULT_PERSIST_STREAM_RELEASE_GRACE_MS = 30_000;
export const PERSIST_STREAM_RELEASE_GRACE_MS_ENV =
  "CONAT_PERSIST_STREAM_RELEASE_GRACE_MS";

type Releasable = {
  close: () => void;
};

type PendingRelease = {
  dueAt: number;
  stream: Releasable;
};

export type PersistStreamReleaseQueueDiagnostics = {
  grace_ms: number;
  pending: number;
  scheduled_total: number;
  released_total: number;
  errors_total: number;
  slow_releases_total: number;
  max_pending: number;
  last_release_duration_ms?: number;
  max_release_duration_ms: number;
};

export function resolvePersistStreamReleaseGraceMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = `${env[PERSIST_STREAM_RELEASE_GRACE_MS_ENV] ?? ""}`.trim();
  if (!raw) {
    return DEFAULT_PERSIST_STREAM_RELEASE_GRACE_MS;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 10 * 60_000) {
    return DEFAULT_PERSIST_STREAM_RELEASE_GRACE_MS;
  }
  return value;
}

export class PersistStreamReleaseQueue {
  private readonly graceMs: number;
  private readonly now: () => number;
  private readonly onError?: (err: unknown) => void;
  private readonly onSlowRelease?: (durationMs: number) => void;
  private pending: PendingRelease[] = [];
  private timeout?: ReturnType<typeof setTimeout>;
  private immediate?: ReturnType<typeof setImmediate>;
  private scheduledTotal = 0;
  private releasedTotal = 0;
  private errorsTotal = 0;
  private slowReleasesTotal = 0;
  private maxPending = 0;
  private lastReleaseDurationMs?: number;
  private maxReleaseDurationMs = 0;

  constructor({
    graceMs = resolvePersistStreamReleaseGraceMs(),
    now = Date.now,
    onError,
    onSlowRelease,
  }: {
    graceMs?: number;
    now?: () => number;
    onError?: (err: unknown) => void;
    onSlowRelease?: (durationMs: number) => void;
  } = {}) {
    this.graceMs = graceMs;
    this.now = now;
    this.onError = onError;
    this.onSlowRelease = onSlowRelease;
  }

  schedule(stream: Releasable): void {
    this.pending.push({
      dueAt: this.now() + this.graceMs,
      stream,
    });
    this.scheduledTotal += 1;
    this.maxPending = Math.max(this.maxPending, this.pending.length);
    this.arm();
  }

  diagnostics(): PersistStreamReleaseQueueDiagnostics {
    return {
      grace_ms: this.graceMs,
      pending: this.pending.length,
      scheduled_total: this.scheduledTotal,
      released_total: this.releasedTotal,
      errors_total: this.errorsTotal,
      slow_releases_total: this.slowReleasesTotal,
      max_pending: this.maxPending,
      last_release_duration_ms: this.lastReleaseDurationMs,
      max_release_duration_ms: this.maxReleaseDurationMs,
    };
  }

  private arm(): void {
    if (this.timeout != null || this.immediate != null) {
      return;
    }
    const next = this.pending[0];
    if (next == null) {
      return;
    }
    const delay = Math.max(0, next.dueAt - this.now());
    if (delay > 0) {
      this.timeout = setTimeout(() => {
        this.timeout = undefined;
        this.releaseOne();
      }, delay);
      this.timeout.unref?.();
      return;
    }
    this.immediate = setImmediate(() => {
      this.immediate = undefined;
      this.releaseOne();
    });
    this.immediate.unref?.();
  }

  private releaseOne(): void {
    const next = this.pending[0];
    if (next == null) {
      return;
    }
    if (next.dueAt > this.now()) {
      this.arm();
      return;
    }
    this.pending.shift();
    const started = this.now();
    try {
      next.stream.close();
    } catch (err) {
      this.errorsTotal += 1;
      this.onError?.(err);
    } finally {
      const durationMs = Math.max(0, this.now() - started);
      this.releasedTotal += 1;
      this.lastReleaseDurationMs = durationMs;
      this.maxReleaseDurationMs = Math.max(
        this.maxReleaseDurationMs,
        durationMs,
      );
      if (durationMs >= 250) {
        this.slowReleasesTotal += 1;
        this.onSlowRelease?.(durationMs);
      }
    }
    // Always yield before releasing another SQLite reference. The final
    // reference closes synchronously to preserve close/reopen exclusion.
    this.arm();
  }
}
