/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { uuid } from "@cocalc/util/misc";

import { elapsedUxMs, recordUxLatencyEvent, startUxTimer } from "./ux-latency";

const DEFAULT_STALE_AFTER_MS = 60_000;
const WALL_CLOCK_SKEW_MS = 10_000;
const MAX_PHASE_DETAILS = 32;

let visibilityEpoch = 0;
let visibilityListenerInstalled = false;

function getVisibilityEpoch(): number {
  if (typeof document === "undefined") return visibilityEpoch;
  if (!visibilityListenerInstalled) {
    visibilityListenerInstalled = true;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        visibilityEpoch += 1;
      }
    });
  }
  return visibilityEpoch;
}

function documentIsHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

export type UxTracePhaseDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface UxTraceRecordOptions {
  path_ext?: string;
  editor?: string;
  segment?: string;
  details?: Record<string, unknown>;
  surface_visible?: boolean;
  classify_stale?: boolean;
}

export interface UxTraceOptions {
  event_type: string;
  project_id?: string;
  host_id?: string;
  client_event_id?: string;
  source?: string;
  surface_visible?: boolean;
  stale_after_ms?: number;
  start?: UxTraceStart;
}

export interface UxTraceStart {
  wall_ms: number;
  ux_ms: number;
  page_hidden: boolean;
  visibility_epoch: number;
}

export function captureUxTraceStart(): UxTraceStart {
  return {
    wall_ms: Date.now(),
    ux_ms: startUxTimer(),
    page_hidden: documentIsHidden(),
    visibility_epoch: getVisibilityEpoch(),
  };
}

export interface UxTraceStaleInput {
  elapsed_ms: number;
  wall_elapsed_ms: number;
  stale_after_ms: number;
  started_hidden: boolean;
  hidden_now: boolean;
  visibility_changed: boolean;
  surface_visible_at_start?: boolean;
  surface_visible_at_end?: boolean;
}

export function classifyUxTraceStaleReason({
  elapsed_ms,
  wall_elapsed_ms,
  stale_after_ms,
  started_hidden,
  hidden_now,
  visibility_changed,
  surface_visible_at_start,
  surface_visible_at_end,
}: UxTraceStaleInput): string | undefined {
  if (elapsed_ms > stale_after_ms) return "elapsed_exceeded_cap";
  if (started_hidden || hidden_now || visibility_changed) return "page_hidden";
  if (wall_elapsed_ms - elapsed_ms > WALL_CLOCK_SKEW_MS) {
    return "wall_clock_skew";
  }
  if (surface_visible_at_start === false) return "surface_hidden_at_start";
  if (surface_visible_at_end === false) return "surface_hidden_at_end";
  return;
}

export class UxLatencyTrace {
  public readonly id: string;
  public readonly started_at: string;
  public readonly marks: Record<string, number> = { intent: 0 };

  private readonly startedHidden: boolean;
  private readonly startedVisibilityEpoch: number;
  private readonly startedSurfaceVisible?: boolean;
  private readonly staleAfterMs: number;
  private readonly startWall: number;
  private readonly startUx: number;
  private readonly emitted = new Set<string>();
  private readonly phaseDetails: Record<string, UxTracePhaseDetails> = {};

  constructor(private readonly options: UxTraceOptions) {
    const start = options.start ?? captureUxTraceStart();
    this.startWall = start.wall_ms;
    this.startUx = start.ux_ms;
    this.startedHidden = start.page_hidden;
    this.startedVisibilityEpoch = start.visibility_epoch;
    this.id = options.client_event_id ?? uuid();
    this.started_at = new Date(this.startWall).toISOString();
    this.startedSurfaceVisible = options.surface_visible;
    this.staleAfterMs = options.stale_after_ms ?? DEFAULT_STALE_AFTER_MS;
    if (options.source) {
      this.phaseDetails.intent = { source: options.source };
    }
  }

  elapsed(): number {
    return elapsedUxMs(this.startUx);
  }

  mark(phase: string, details?: UxTracePhaseDetails): number {
    const elapsed = this.elapsed();
    this.marks[phase] = elapsed;
    if (
      details != null &&
      Object.keys(this.phaseDetails).length < MAX_PHASE_DETAILS
    ) {
      this.phaseDetails[phase] = details;
    }
    return elapsed;
  }

  hasEmitted(endpoint: string): boolean {
    return this.emitted.has(endpoint);
  }

  record(endpoint: string, options: UxTraceRecordOptions = {}): boolean {
    if (this.emitted.has(endpoint)) return false;
    this.emitted.add(endpoint);
    const elapsed = this.mark(endpoint);
    const wallElapsed = Date.now() - this.startWall;
    const staleReason =
      options.classify_stale === false
        ? undefined
        : classifyUxTraceStaleReason({
            elapsed_ms: elapsed,
            wall_elapsed_ms: wallElapsed,
            stale_after_ms: this.staleAfterMs,
            started_hidden: this.startedHidden,
            hidden_now: documentIsHidden(),
            visibility_changed:
              getVisibilityEpoch() !== this.startedVisibilityEpoch,
            surface_visible_at_start: this.startedSurfaceVisible,
            surface_visible_at_end: options.surface_visible,
          });
    recordUxLatencyEvent({
      event_type: this.options.event_type,
      metric: staleReason == null ? endpoint : `${endpoint}_stale`,
      duration_ms: elapsed,
      project_id: this.options.project_id,
      host_id: this.options.host_id,
      client_event_id: this.id,
      started_at: this.started_at,
      path_ext: options.path_ext,
      editor: options.editor,
      segment: options.segment,
      details: {
        trace_version: 2,
        marks: { ...this.marks },
        phase_details: { ...this.phaseDetails },
        ...(this.options.source ? { source: this.options.source } : {}),
        ...(options.details ?? {}),
        ...(staleReason == null
          ? {}
          : {
              stale_reason: staleReason,
              wall_elapsed_ms: wallElapsed,
              wall_clock_skew_ms: wallElapsed - elapsed,
            }),
      },
    });
    return true;
  }
}

export function afterNextPaint(callback: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.requestAnimationFrame !== "function"
  ) {
    callback();
    return () => {};
  }
  const frame = window.requestAnimationFrame(callback);
  return () => window.cancelAnimationFrame(frame);
}
