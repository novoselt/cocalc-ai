/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const EVENT_NAME = "cc:internalStateChange";
const READY_EVENT_NAME = "cc:internalReady";

let active = false;
let decided = false;
let ready = false;

function emit(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT_NAME));
  }
}

export function markBannerActive(): void {
  active = true;
  decided = true;
  ready = false;
  emit();
}

export function markBannerReady(): void {
  ready = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(READY_EVENT_NAME));
  }
}

export function markBannerDecidedDisabled(): void {
  active = false;
  decided = true;
  ready = false;
  emit();
}

export function isBannerActive(): boolean {
  return active;
}

export function isBannerDecided(): boolean {
  return decided;
}

export function isBannerReady(): boolean {
  return ready;
}

export const BANNER_STATE_EVENT = EVENT_NAME;
export const BANNER_READY_EVENT = READY_EVENT_NAME;
