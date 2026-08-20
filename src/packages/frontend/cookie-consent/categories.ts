/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

interface CookieItem {
  name: string | RegExp;
}

// "cookies" categories control browser storage; "communication" categories
// control optional email.  Both are optional consent the banner collects in one
// go, which is why they share the consent record and revision.
export type CookieCategoryKind = "cookies" | "communication";

export interface CookieCategory {
  readonly key: string;
  readonly kind: CookieCategoryKind;
  readonly label: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly defaultEnabled: boolean;
  readonly autoClearCookies?: ReadonlyArray<CookieItem>;
}

export const COOKIE_CATEGORIES = [
  {
    key: "necessary",
    kind: "cookies",
    label: "Necessary cookies",
    description:
      "Required for sign-in and to keep your session active. These cookies cannot be turned off.",
    readOnly: true,
    defaultEnabled: true,
  },
  {
    key: "analytics",
    kind: "cookies",
    label: "Analytics cookies",
    description:
      "First- and third-party analytics that help us understand how the site is used.",
    readOnly: false,
    defaultEnabled: false,
    autoClearCookies: [{ name: /^_ga/ }, { name: /^_gid/ }, { name: "CC_ANA" }],
  },
  {
    key: "usage",
    kind: "cookies",
    label: "Usage metrics",
    description:
      "First-party metrics recorded in our own database to help us improve the product.",
    readOnly: false,
    defaultEnabled: false,
  },
  {
    key: "marketing",
    kind: "communication",
    label: "Onboarding and marketing emails",
    description:
      "Optional onboarding help, product tips, and marketing emails. This is an email preference, not a cookie. Transactional email about security, billing, and your account is always sent.",
    readOnly: false,
    defaultEnabled: false,
  },
] as const satisfies ReadonlyArray<CookieCategory>;

export type CookieCategoryKey = (typeof COOKIE_CATEGORIES)[number]["key"];

// Consent category that maps onto the account's marketing email preference.
export const MARKETING_CONSENT_CATEGORY =
  "marketing" satisfies CookieCategoryKey;

export const COOKIES_SECTION_TITLE = "Cookies and usage data";
export const COMMUNICATION_SECTION_TITLE = "Communication preferences";
export const COMMUNICATION_SECTION_DESCRIPTION =
  "These choices are not cookies. They control optional email we send you, and you can change them at any time in Communication settings.";
