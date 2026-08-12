/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import { joinUrlPath } from "@cocalc/util/url-path";

interface PrefetchSignals {
  documentHidden: boolean;
  downlinkMbps?: number;
  effectiveConnectionType?: string;
  hardwareConcurrency?: number;
  reducedOverride?: boolean;
  saveData?: boolean;
}

export function shouldPrefetchSignedInShell({
  documentHidden,
  downlinkMbps,
  effectiveConnectionType,
  hardwareConcurrency,
  reducedOverride,
  saveData,
}: PrefetchSignals): boolean {
  if (documentHidden || reducedOverride || saveData) return false;
  if (["slow-2g", "2g"].includes(effectiveConnectionType ?? "")) return false;
  if (downlinkMbps != null && downlinkMbps <= 1.5) return false;
  if (hardwareConcurrency != null && hardwareConcurrency <= 2) return false;
  return true;
}

function browserSignals(): PrefetchSignals {
  const connection = (navigator as any).connection;
  let reducedOverride = false;
  try {
    reducedOverride =
      localStorage.getItem("cocalc-startup-performance-mode-v1") === "reduced";
  } catch {
    // A blocked localStorage simply means there is no explicit override.
  }
  return {
    documentHidden: document.hidden,
    downlinkMbps: Number.isFinite(connection?.downlink)
      ? connection.downlink
      : undefined,
    effectiveConnectionType:
      typeof connection?.effectiveType === "string"
        ? connection.effectiveType
        : undefined,
    hardwareConcurrency: Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : undefined,
    reducedOverride,
    saveData: connection?.saveData === true,
  };
}

function alreadyRequested(url: string): boolean {
  return (performance.getEntriesByType?.("resource") ?? []).some(
    (entry) => entry.name === url,
  );
}

let prefetching: Promise<void> | undefined;

export function prefetchSignedInShell(): Promise<void> {
  if (!shouldPrefetchSignedInShell(browserSignals())) {
    return Promise.resolve();
  }
  if (prefetching != null) return prefetching;
  prefetching = (async () => {
    const manifestUrl = new URL(
      joinUrlPath(appBasePath, "static/app.html"),
      window.location.origin,
    );
    const response = await fetch(manifestUrl, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return;
    const document = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    const urls = new Set(
      [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
        (script) => new URL(script.getAttribute("src") ?? "", manifestUrl).href,
      ),
    );
    for (const url of urls) {
      if (alreadyRequested(url)) continue;
      const link = window.document.createElement("link");
      link.rel = "prefetch";
      link.as = "script";
      link.href = url;
      if (new URL(url).origin !== window.location.origin) {
        link.crossOrigin = "anonymous";
      }
      window.document.head.appendChild(link);
    }
  })().catch(() => {
    // Authentication must never depend on speculative cache warming.
    prefetching = undefined;
  });
  return prefetching;
}
