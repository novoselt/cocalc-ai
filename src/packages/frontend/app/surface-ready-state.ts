/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

type Listener = (segment: string) => void;

let readySegment: string | undefined;
const listeners = new Set<Listener>();

export function signedInSurfaceReadySegment(): string | undefined {
  return readySegment;
}

export function markSignedInSurfaceReady(segment: string): void {
  if (readySegment != null) return;
  readySegment = segment;
  for (const listener of listeners) {
    try {
      listener(segment);
    } catch {
      // Optional post-surface work must not break startup telemetry.
    }
  }
}

export function onSignedInSurfaceReady(listener: Listener): () => void {
  listeners.add(listener);
  if (readySegment != null) {
    listener(readySegment);
  }
  return () => listeners.delete(listener);
}
