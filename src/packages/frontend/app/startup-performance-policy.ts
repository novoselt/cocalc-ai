/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export type StartupPerformanceOverride = "auto" | "full" | "reduced";
export type StartupPerformanceMode = "full" | "reduced";

export interface StartupPerformanceSignals {
  deviceMemoryGb?: number;
  downlinkMbps?: number;
  effectiveConnectionType?: string;
  hardwareConcurrency?: number;
  smallTouchDevice?: boolean;
  saveData?: boolean;
}

export interface StartupPerformancePolicy {
  mode: StartupPerformanceMode;
  override: StartupPerformanceOverride;
  reasons: string[];
  signals: StartupPerformanceSignals;
}

const STORAGE_KEY = "cocalc-startup-performance-mode-v1";
const CHANGE_EVENT = "cocalc-startup-performance-policy-change";

function finitePositive(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function classifyStartupPerformancePolicy({
  override,
  signals,
}: {
  override: StartupPerformanceOverride;
  signals: StartupPerformanceSignals;
}): StartupPerformancePolicy {
  if (override !== "auto") {
    return {
      mode: override,
      override,
      reasons: [`override:${override}`],
      signals,
    };
  }
  const reasons: string[] = [];
  if (signals.saveData) reasons.push("save-data");
  if (["slow-2g", "2g"].includes(signals.effectiveConnectionType ?? "")) {
    reasons.push(`connection:${signals.effectiveConnectionType}`);
  }
  if (signals.downlinkMbps != null && signals.downlinkMbps <= 1.5) {
    reasons.push("downlink");
  }
  if (signals.hardwareConcurrency != null && signals.hardwareConcurrency <= 2) {
    reasons.push("cpu");
  }
  if (signals.deviceMemoryGb != null && signals.deviceMemoryGb <= 2) {
    reasons.push("memory");
  }
  if (signals.smallTouchDevice) reasons.push("small-touch-device");
  return {
    mode: reasons.length > 0 ? "reduced" : "full",
    override,
    reasons,
    signals,
  };
}

export function getStartupPerformanceOverride(): StartupPerformanceOverride {
  if (typeof localStorage === "undefined") return "auto";
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "full" || value === "reduced" ? value : "auto";
  } catch {
    return "auto";
  }
}

export function setStartupPerformanceOverride(
  value: StartupPerformanceOverride,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (value === "auto") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, value);
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // A blocked localStorage must not affect application behavior.
  }
}

function browserSignals(): StartupPerformanceSignals {
  if (typeof navigator === "undefined") return {};
  const connection = (navigator as any).connection;
  const narrow = typeof window !== "undefined" && window.innerWidth <= 700;
  return {
    deviceMemoryGb: finitePositive((navigator as any).deviceMemory),
    downlinkMbps: finitePositive(connection?.downlink),
    effectiveConnectionType:
      typeof connection?.effectiveType === "string"
        ? connection.effectiveType
        : undefined,
    hardwareConcurrency: finitePositive(navigator.hardwareConcurrency),
    saveData: connection?.saveData === true,
    smallTouchDevice: narrow && (navigator.maxTouchPoints ?? 0) > 0,
  };
}

let cachedPolicy: StartupPerformancePolicy | undefined;
let cachedSignature = "";

export function getStartupPerformancePolicy(): StartupPerformancePolicy {
  const next = classifyStartupPerformancePolicy({
    override: getStartupPerformanceOverride(),
    signals: browserSignals(),
  });
  const signature = JSON.stringify(next);
  if (cachedPolicy == null || signature !== cachedSignature) {
    cachedPolicy = next;
    cachedSignature = signature;
  }
  return cachedPolicy;
}

export function subscribeStartupPerformancePolicy(
  listener: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const connection = (navigator as any).connection;
  window.addEventListener("storage", listener);
  window.addEventListener("resize", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  connection?.addEventListener?.("change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("resize", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
    connection?.removeEventListener?.("change", listener);
  };
}

export type PostSurfaceWork = "navigation" | "modals" | "banners";

export function postSurfaceDelayMs(
  mode: StartupPerformanceMode,
  work: PostSurfaceWork,
): number {
  if (mode === "full") return 0;
  switch (work) {
    case "navigation":
      return 750;
    case "modals":
      return 2_000;
    case "banners":
      return 4_000;
  }
}
