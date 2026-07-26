/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import { joinUrlPath } from "@cocalc/util/url-path";

import { hasTrackingConsent } from "./index";

const SCRIPT_ID = "cocalc-first-party-analytics";

interface AnalyticsWindow extends Window {
  __cocalcFirstPartyAnalyticsReady?: Promise<unknown>;
}

let loadPromise: Promise<boolean> | undefined;

function analyticsUrl(): string {
  return `${joinUrlPath(appBasePath, "analytics.js")}?fqd=false`;
}

export function loadFirstPartyAnalytics(): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }
  if (!hasTrackingConsent()) {
    return Promise.resolve(false);
  }
  if (loadPromise != null) {
    return loadPromise;
  }

  const existing = document.getElementById(
    SCRIPT_ID,
  ) as HTMLScriptElement | null;
  if (existing?.dataset.loaded === "true") {
    return Promise.resolve(true);
  }

  loadPromise = new Promise<boolean>((resolve) => {
    const script = existing ?? document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    const finish = (loaded: boolean) => {
      if (loaded) {
        script.dataset.loaded = "true";
      } else {
        script.remove();
        loadPromise = undefined;
      }
      resolve(loaded);
    };
    script.addEventListener("load", () => finish(true), { once: true });
    script.addEventListener("error", () => finish(false), { once: true });
    if (existing == null) {
      script.src = analyticsUrl();
      document.head.appendChild(script);
    }
  });
  return loadPromise;
}

export async function linkFirstPartyAnalyticsAccount(): Promise<void> {
  try {
    if (!hasTrackingConsent()) return;
    if (!(await loadFirstPartyAnalytics())) return;

    const analyticsWindow = window as AnalyticsWindow;
    await analyticsWindow.__cocalcFirstPartyAnalyticsReady;
    await window.fetch(joinUrlPath(appBasePath, "analytics.js"), {
      method: "POST",
      cache: "no-cache",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      redirect: "follow",
      body: JSON.stringify({ account_link: true }),
    });
  } catch {
    // Optional telemetry must never interfere with the application.
  }
}
