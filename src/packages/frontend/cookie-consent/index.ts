/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { useEffect, useState } from "react";

import * as CookieConsent from "vanilla-cookieconsent";

import { COLORS } from "@cocalc/util/theme";

import { COOKIE_CATEGORIES, type CookieCategoryKey } from "./categories";
import {
  BANNER_READY_EVENT,
  BANNER_STATE_EVENT,
  isBannerActive,
  isBannerDecided,
  isBannerReady,
} from "./state";

export { COOKIE_CATEGORIES };
export type { CookieCategoryKey };

export const COOKIE_CONSENT_REVISION = 2;

export type ConsentSnapshot = Record<CookieCategoryKey, boolean> & {
  timestamp: string;
  revision: number;
};

export function hasEssentialConsent(): boolean {
  if (typeof window === "undefined") return false;
  if (!isBannerDecided()) return false;
  if (!isBannerActive()) return true;
  try {
    return CookieConsent.validConsent();
  } catch {
    return false;
  }
}

export function hasCategoryConsent(key: CookieCategoryKey): boolean {
  if (typeof window === "undefined") return false;
  try {
    return CookieConsent.acceptedCategory(key);
  } catch {
    return false;
  }
}

export function hasTrackingConsent(): boolean {
  return hasCategoryConsent("analytics");
}

export function showConsentModal(): void {
  if (typeof window === "undefined") return;
  try {
    CookieConsent.show(true);
  } catch {
    // Banner not initialized.
  }
}

const FORCE_CONSENT_OVERLAY_ID = "cocalc-cookie-consent-force-overlay";
const FORCE_CONSENT_VISIBILITY_DELAY_MS = 500;
let forceConsentCount = 0;

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function ensureForceConsentOverlay(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(FORCE_CONSENT_OVERLAY_ID) != null) return;
  const overlay = document.createElement("div");
  overlay.id = FORCE_CONSENT_OVERLAY_ID;
  overlay.setAttribute("aria-hidden", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483000",
    background: hexToRgba(COLORS.GRAY_DD, 0.58),
    pointerEvents: "auto",
    cursor: "not-allowed",
  });
  document.body.appendChild(overlay);
}

function removeForceConsentOverlay(): void {
  if (typeof document === "undefined") return;
  document.getElementById(FORCE_CONSENT_OVERLAY_ID)?.remove();
}

function isConsentModalVisible(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }
  const modal = document.querySelector<HTMLElement>("#cc-main .cm");
  if (modal == null || !modal.isConnected) return false;

  let element: HTMLElement | null = modal;
  while (element != null) {
    const style = window.getComputedStyle(element);
    if (
      element.hidden ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    ) {
      return false;
    }
    if (element.id === "cc-main") break;
    element = element.parentElement;
  }
  return element?.id === "cc-main";
}

export function enableForceConsent(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  if (isBannerDecided() && !isBannerActive()) return () => {};
  if (hasEssentialConsent()) return () => {};
  const html = document.documentElement;
  forceConsentCount += 1;

  let removed = false;
  let visibilityTimer: number | undefined;
  function remove() {
    if (removed) return;
    removed = true;
    if (visibilityTimer != null) {
      window.clearTimeout(visibilityTimer);
      visibilityTimer = undefined;
    }
    forceConsentCount = Math.max(0, forceConsentCount - 1);
    if (forceConsentCount === 0) {
      html.classList.remove("disable--interaction");
      removeForceConsentOverlay();
    }
    window.removeEventListener("cc:onConsent", remove);
    window.removeEventListener("cc:onChange", remove);
    window.removeEventListener(BANNER_READY_EVENT, activate);
  }

  function activate() {
    if (removed) return;
    if (hasEssentialConsent()) {
      remove();
      return;
    }
    html.classList.add("disable--interaction");
    ensureForceConsentOverlay();
    showConsentModal();
    visibilityTimer = window.setTimeout(() => {
      visibilityTimer = undefined;
      if (!isConsentModalVisible()) {
        // Privacy extensions may hide the consent UI without removing it.
        // Never leave CoCalc's independent interaction blocker behind.
        remove();
      }
    }, FORCE_CONSENT_VISIBILITY_DELAY_MS);
  }

  window.addEventListener("cc:onConsent", remove);
  window.addEventListener("cc:onChange", remove);
  if (isBannerReady()) {
    activate();
  } else {
    window.addEventListener(BANNER_READY_EVENT, activate);
  }
  return remove;
}

export function showPreferences(): void {
  if (typeof window === "undefined") return;
  try {
    CookieConsent.showPreferences();
  } catch {
    showConsentModal();
  }
}

export function requireEssentialConsent(): boolean {
  if (hasEssentialConsent()) return true;
  showConsentModal();
  return false;
}

export function restoreConsentCookieFromSnapshot(
  snap: ConsentSnapshot | null,
): boolean {
  if (typeof document === "undefined") return false;
  if (snap == null) return false;
  if (document.cookie.split(";").some((c) => c.trim().startsWith("cc_cookie=")))
    return false;
  if (snap.revision !== COOKIE_CONSENT_REVISION) return false;

  const categories: string[] = [];
  const services: Record<string, string[]> = {};
  for (const category of COOKIE_CATEGORIES) {
    services[category.key] = [];
    if ((snap as Record<string, unknown>)[category.key]) {
      categories.push(category.key);
    }
  }
  if (!categories.includes("necessary")) {
    categories.push("necessary");
  }

  const timestamp = snap.timestamp || new Date().toISOString();
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  const value = {
    categories,
    revision: snap.revision,
    data: null,
    consentTimestamp: timestamp,
    consentId: cryptoRandomId(),
    services,
    languageCode: "en",
    lastConsentTimestamp: timestamp,
    expirationTime: Date.now() + oneYearMs,
  };
  document.cookie =
    "cc_cookie=" +
    encodeURIComponent(JSON.stringify(value)) +
    `; path=/; max-age=${oneYearMs / 1000}; SameSite=Lax`;
  return true;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getConsentSnapshot(): ConsentSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    if (!CookieConsent.validConsent()) return null;
    const cookie = CookieConsent.getCookie();
    if (cookie == null) return null;
    const accepted = new Set<string>(cookie.categories ?? []);
    const snap = {
      timestamp: cookie.lastConsentTimestamp ?? cookie.consentTimestamp ?? "",
      revision: cookie.revision ?? 0,
    } as ConsentSnapshot;
    for (const category of COOKIE_CATEGORIES) {
      (snap as Record<string, boolean | string | number>)[category.key] =
        accepted.has(category.key);
    }
    return snap;
  } catch {
    return null;
  }
}

type Unsubscribe = () => void;

export function onConsentChange(
  cb: (snap: ConsentSnapshot | null) => void,
): Unsubscribe {
  if (typeof window === "undefined") return () => {};
  let timer: number | undefined;
  const handler = () => {
    cb(getConsentSnapshot());
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => cb(getConsentSnapshot()), 0);
  };
  window.addEventListener("cc:onConsent", handler);
  window.addEventListener("cc:onChange", handler);
  window.addEventListener(BANNER_STATE_EVENT, handler);
  handler();
  return () => {
    window.removeEventListener("cc:onConsent", handler);
    window.removeEventListener("cc:onChange", handler);
    window.removeEventListener(BANNER_STATE_EVENT, handler);
    if (timer != null) window.clearTimeout(timer);
  };
}

export function useEssentialConsent(): boolean {
  const [accepted, setAccepted] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setAccepted(hasEssentialConsent());
    update();
    window.addEventListener("cc:onConsent", update);
    window.addEventListener("cc:onChange", update);
    window.addEventListener(BANNER_STATE_EVENT, update);
    return () => {
      window.removeEventListener("cc:onConsent", update);
      window.removeEventListener("cc:onChange", update);
      window.removeEventListener(BANNER_STATE_EVENT, update);
    };
  }, []);
  return accepted;
}

export function clearAllConsentCookies(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const names = new Set<string>(["cc_cookie"]);
  const matchers: Array<string | RegExp> = [];
  for (const category of COOKIE_CATEGORIES) {
    if (!("autoClearCookies" in category)) continue;
    for (const item of category.autoClearCookies) {
      matchers.push(item.name);
    }
  }
  for (const matcher of matchers) {
    if (typeof matcher === "string") {
      names.add(matcher);
    } else {
      for (const cookie of document.cookie.split(";")) {
        const name = cookie.trim().split("=")[0];
        if (name && matcher.test(name)) names.add(name);
      }
    }
  }

  for (const name of names) {
    for (const domain of parentDomainCandidates(window.location.hostname)) {
      document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax${
        domain == null ? "" : `; domain=${domain}`
      }`;
    }
  }
}

function parentDomainCandidates(hostname: string): Array<string | undefined> {
  const result: Array<string | undefined> = [undefined];
  const parts = hostname.split(".");
  for (let i = 0; i < parts.length; i++) {
    const suffix = parts.slice(i).join(".");
    if (!suffix) continue;
    result.push(suffix, `.${suffix}`);
  }
  return result;
}
