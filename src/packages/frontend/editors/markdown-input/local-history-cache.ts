/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import LRU from "lru-cache";

interface CachedLocalHistory<T> {
  value: string;
  history: T;
}

// Editors are frequently unmounted by notebook rendering and windowing. Keep
// their local undo state bounded, and consume each entry when its editor mounts.
const cache = new LRU<string, CachedLocalHistory<unknown>>({ max: 1000 });

export function saveLocalHistory<T>(
  key: string | undefined,
  value: string,
  history: T,
): void {
  if (key == null) return;
  cache.set(key, { value, history });
}

export function takeLocalHistory<T>(
  key: string | undefined,
  value: string,
): T | undefined {
  if (key == null) return;
  const cached = cache.get(key) as CachedLocalHistory<T> | undefined;
  cache.delete(key);
  if (cached?.value !== value) return;
  return cached.history;
}

export function clearLocalHistory(key: string | undefined): void {
  if (key != null) {
    cache.delete(key);
  }
}
