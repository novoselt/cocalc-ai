/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  GrowthEventInput,
  GrowthEventName,
} from "@cocalc/conat/hub/api/growth-analytics";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { uuid } from "@cocalc/util/misc";

const MINUTE_MS = 60_000;
const recentlySent = new Map<string, number>();
const engagementTimers = new Map<string, ReturnType<typeof setTimeout>>();

function eventWindowMs(eventName: GrowthEventName): number {
  if (eventName === "app_foreground") return 60 * MINUTE_MS;
  if (eventName === "project_work" || eventName === "ai_prompt_submitted") {
    return 5 * MINUTE_MS;
  }
  return 30 * MINUTE_MS;
}

export function recordProductActivity({
  event_name,
  project_id,
  properties,
  experiment,
  variant,
  dedupe_key,
}: {
  event_name: GrowthEventName;
  project_id?: string;
  properties?: GrowthEventInput["properties"];
  experiment?: string;
  variant?: string;
  dedupe_key?: string;
}): void {
  const now = Date.now();
  const key = [
    event_name,
    project_id ?? "account",
    properties?.action_category ?? "",
    dedupe_key ?? "",
  ].join(":");
  const previous = recentlySent.get(key) ?? 0;
  if (now - previous < eventWindowMs(event_name)) return;
  recentlySent.set(key, now);
  try {
    const record =
      webapp_client.conat_client?.hub?.growthAnalytics?.recordEvent;
    if (typeof record !== "function") {
      recentlySent.delete(key);
      return;
    }
    void record({
      event: {
        event_id: uuid(),
        event_name,
        occurred_at: new Date(now).toISOString(),
        project_id,
        source_component: "browser",
        properties,
        experiment,
        variant,
      },
    }).catch(() => {
      // Product analytics must never interfere with the measured action.
      recentlySent.delete(key);
    });
  } catch {
    recentlySent.delete(key);
  }
}

export function recordProjectEngagedAfterForeground(
  project_id: string,
  delayMs = MINUTE_MS,
): void {
  if (!project_id || engagementTimers.has(project_id)) return;
  if (typeof document !== "undefined" && document.hidden) return;
  const onVisibility = () => {
    if (typeof document === "undefined" || !document.hidden) return;
    const timer = engagementTimers.get(project_id);
    if (timer) clearTimeout(timer);
    engagementTimers.delete(project_id);
    document.removeEventListener("visibilitychange", onVisibility);
    const resume = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", resume);
      recordProjectEngagedAfterForeground(project_id, delayMs);
    };
    document.addEventListener("visibilitychange", resume);
  };
  const timer = setTimeout(() => {
    engagementTimers.delete(project_id);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
      if (document.hidden) return;
    }
    recordProductActivity({ event_name: "app_foreground", project_id });
    recordProductActivity({ event_name: "project_engaged", project_id });
  }, delayMs);
  engagementTimers.set(project_id, timer);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
}

export function resetProductActivityForTests(): void {
  recentlySent.clear();
  for (const timer of engagementTimers.values()) clearTimeout(timer);
  engagementTimers.clear();
}
