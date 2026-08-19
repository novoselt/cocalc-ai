/** @jest-environment jsdom */

import {
  clearAllConsentCookies,
  COOKIE_CONSENT_REVISION,
  enableForceConsent,
  restoreConsentCookieFromSnapshot,
  setMarketingConsent,
  takePendingMarketingConsentSource,
  type ConsentSnapshot,
} from "./index";
import { markBannerActive, markBannerReady } from "./state";

const show = jest.fn();
const acceptCategory = jest.fn();
let validConsent = false;
let acceptedCategories = new Set<string>();

jest.mock("vanilla-cookieconsent", () => ({
  acceptCategory: (...args: any[]) => acceptCategory(...args),
  acceptedCategory: (name: string) => acceptedCategories.has(name),
  getCookie: jest.fn(() => null),
  show: (...args: any[]) => show(...args),
  showPreferences: jest.fn(),
  validConsent: () => validConsent,
}));

jest.mock("@cocalc/util/theme", () => ({ COLORS: { GRAY_DD: "#303030" } }), {
  virtual: true,
});

const FORCE_CONSENT_OVERLAY_ID = "cocalc-cookie-consent-force-overlay";

function expireCookie(name: string): void {
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

function getCookieValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
}

beforeEach(() => {
  for (const name of ["cc_cookie", "_ga", "_gid", "CC_ANA"]) {
    expireCookie(name);
  }
  document.body.innerHTML = "";
  document.documentElement.className = "";
  validConsent = false;
  acceptedCategories = new Set<string>();
  show.mockClear();
  acceptCategory.mockReset();
  takePendingMarketingConsentSource();
  markBannerActive();
});

describe("cookie consent snapshots", () => {
  it("restores a current account snapshot into the runtime consent cookie", () => {
    const snap: ConsentSnapshot = {
      necessary: true,
      analytics: false,
      usage: true,
      marketing: true,
      revision: COOKIE_CONSENT_REVISION,
      timestamp: "2026-05-19T12:00:00.000Z",
    };

    expect(restoreConsentCookieFromSnapshot(snap)).toBe(true);

    const raw = getCookieValue("cc_cookie");
    expect(raw).toBeDefined();
    const restored = JSON.parse(decodeURIComponent(raw!));
    expect(restored.categories).toEqual(["necessary", "usage", "marketing"]);
    expect(restored.revision).toBe(COOKIE_CONSENT_REVISION);
    expect(restored.lastConsentTimestamp).toBe(snap.timestamp);
  });

  it("does not restore stale snapshots or overwrite an existing cookie", () => {
    const snap: ConsentSnapshot = {
      necessary: true,
      analytics: true,
      usage: true,
      marketing: true,
      revision: COOKIE_CONSENT_REVISION - 1,
      timestamp: "2026-05-19T12:00:00.000Z",
    };

    expect(restoreConsentCookieFromSnapshot(snap)).toBe(false);
    expect(getCookieValue("cc_cookie")).toBeUndefined();

    document.cookie = "cc_cookie=existing; path=/; SameSite=Lax";
    expect(
      restoreConsentCookieFromSnapshot({
        ...snap,
        revision: COOKIE_CONSENT_REVISION,
      }),
    ).toBe(false);
    expect(getCookieValue("cc_cookie")).toBe("existing");
  });

  it("clears the consent cookie and registered analytics cookies", () => {
    document.cookie = "cc_cookie=1; path=/; SameSite=Lax";
    document.cookie = "_ga=1; path=/; SameSite=Lax";
    document.cookie = "_gid=1; path=/; SameSite=Lax";
    document.cookie = "CC_ANA=1; path=/; SameSite=Lax";

    clearAllConsentCookies();

    expect(getCookieValue("cc_cookie")).toBeUndefined();
    expect(getCookieValue("_ga")).toBeUndefined();
    expect(getCookieValue("_gid")).toBeUndefined();
    expect(getCookieValue("CC_ANA")).toBeUndefined();
  });
});

describe("marketing consent", () => {
  it("flips only the marketing category and keeps the other choices", () => {
    validConsent = true;
    acceptedCategories = new Set(["necessary", "analytics"]);

    expect(setMarketingConsent(true, "communication-settings")).toBe("changed");
    expect(acceptCategory).toHaveBeenCalledWith([
      "necessary",
      "analytics",
      "marketing",
    ]);

    acceptCategory.mockClear();
    acceptedCategories = new Set(["necessary", "analytics", "marketing"]);
    expect(setMarketingConsent(false, "communication-settings")).toBe(
      "changed",
    );
    expect(acceptCategory).toHaveBeenCalledWith(["necessary", "analytics"]);
  });

  it("hands the origin to the listener that runs during acceptCategory", () => {
    validConsent = true;
    acceptedCategories = new Set(["necessary"]);
    // vanilla-cookieconsent dispatches cc:onChange synchronously, so the
    // decision is consumed before setMarketingConsent returns.
    let observed: string | null | undefined;
    acceptCategory.mockImplementation(() => {
      observed = takePendingMarketingConsentSource();
    });

    setMarketingConsent(true, "communication-settings");

    expect(observed).toBe("communication-settings");
    expect(takePendingMarketingConsentSource()).toBeNull();
  });

  it("does not leave a stale origin behind when nothing changed", () => {
    validConsent = true;
    acceptedCategories = new Set(["necessary", "marketing"]);

    setMarketingConsent(true, "communication-settings");

    // Otherwise the next decision made in the banner is mislabelled.
    expect(takePendingMarketingConsentSource()).toBeNull();
  });

  it("reports when the banner already holds the requested value", () => {
    validConsent = true;
    acceptedCategories = new Set(["necessary", "marketing"]);

    // No consent event follows, so the caller must write the account itself.
    expect(setMarketingConsent(true, "communication-settings")).toBe(
      "unchanged",
    );
    expect(acceptCategory).not.toHaveBeenCalled();
    expect(takePendingMarketingConsentSource()).toBeNull();
  });

  it("does not write consent before the visitor decided", () => {
    validConsent = false;

    expect(setMarketingConsent(true, "communication-settings")).toBe(
      "unavailable",
    );
    expect(acceptCategory).not.toHaveBeenCalled();
  });
});

describe("forced cookie consent", () => {
  it("waits for the banner before blocking the page", () => {
    enableForceConsent();

    expect(document.getElementById(FORCE_CONSENT_OVERLAY_ID)).toBeNull();
    expect(document.documentElement.classList).not.toContain(
      "disable--interaction",
    );
    expect(show).not.toHaveBeenCalled();

    markBannerReady();

    const overlay = document.getElementById(FORCE_CONSENT_OVERLAY_ID);
    expect(overlay).not.toBeNull();
    expect(overlay?.style.position).toBe("fixed");
    expect(overlay?.style.pointerEvents).toBe("auto");
    expect(document.documentElement.classList).toContain(
      "disable--interaction",
    );
    expect(show).toHaveBeenCalledWith(true);

    window.dispatchEvent(new Event("cc:onConsent"));

    expect(document.getElementById(FORCE_CONSENT_OVERLAY_ID)).toBeNull();
    expect(document.documentElement.classList).not.toContain(
      "disable--interaction",
    );
  });

  it("keeps the page blocked while another force-consent caller is active", () => {
    const firstCleanup = enableForceConsent();
    const secondCleanup = enableForceConsent();
    markBannerReady();

    firstCleanup();
    expect(document.getElementById(FORCE_CONSENT_OVERLAY_ID)).not.toBeNull();
    expect(document.documentElement.classList).toContain(
      "disable--interaction",
    );

    secondCleanup();
    expect(document.getElementById(FORCE_CONSENT_OVERLAY_ID)).toBeNull();
    expect(document.documentElement.classList).not.toContain(
      "disable--interaction",
    );
  });

  it("does not block the page after essential consent exists", () => {
    validConsent = true;

    enableForceConsent();

    expect(document.getElementById(FORCE_CONSENT_OVERLAY_ID)).toBeNull();
    expect(show).not.toHaveBeenCalled();
  });

  it("unblocks the page when an extension hides the consent dialog", () => {
    jest.useFakeTimers();
    const consentRoot = document.createElement("div");
    consentRoot.id = "cc-main";
    consentRoot.style.display = "none";
    const modal = document.createElement("div");
    modal.className = "cm";
    consentRoot.appendChild(modal);
    document.body.appendChild(consentRoot);

    enableForceConsent();
    markBannerReady();

    expect(document.getElementById(FORCE_CONSENT_OVERLAY_ID)).not.toBeNull();
    jest.runAllTimers();

    expect(document.getElementById(FORCE_CONSENT_OVERLAY_ID)).toBeNull();
    expect(document.documentElement.classList).not.toContain(
      "disable--interaction",
    );
    jest.useRealTimers();
  });

  it("keeps blocking while the consent dialog is visible", () => {
    jest.useFakeTimers();
    const consentRoot = document.createElement("div");
    consentRoot.id = "cc-main";
    const modal = document.createElement("div");
    modal.className = "cm";
    consentRoot.appendChild(modal);
    document.body.appendChild(consentRoot);

    const cleanup = enableForceConsent();
    markBannerReady();
    jest.runAllTimers();

    expect(document.getElementById(FORCE_CONSENT_OVERLAY_ID)).not.toBeNull();
    expect(document.documentElement.classList).toContain(
      "disable--interaction",
    );

    cleanup();
    jest.useRealTimers();
  });
});
