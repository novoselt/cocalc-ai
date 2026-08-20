/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

// Drives the real vanilla-cookieconsent UI: the banner's own markup is what
// users actually click, so the categories must be wired through it end to end.

import { getConsentSnapshot, hasMarketingConsent } from "./index";
import { initCookieConsent } from "./init";

function click(element: Element | null | undefined): void {
  if (element == null) throw Error("element not found");
  (element as HTMLElement).click();
}

function buttonByText(text: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
}

function toggleFor(category: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    `input[type="checkbox"][value="${category}"]`,
  );
}

it("saves a de-selected marketing category through the preferences modal", async () => {
  initCookieConsent({ enabled: true });
  await new Promise((resolve) => setTimeout(resolve, 0));

  click(buttonByText("Accept all"));
  expect(getConsentSnapshot()?.marketing).toBe(true);
  expect(hasMarketingConsent()).toBe(true);

  const { showPreferences } = await import("./index");
  showPreferences();

  const marketing = toggleFor("marketing");
  expect(marketing).not.toBeNull();
  marketing!.click();
  expect(marketing!.checked).toBe(false);

  const before = getConsentSnapshot();
  click(buttonByText("Save preferences"));
  const after = getConsentSnapshot();

  expect(after?.marketing).toBe(false);
  expect(after?.analytics).toBe(true);
  // The account mirror keys off this timestamp, so a saved change must move it.
  expect(after?.timestamp).not.toBe(before?.timestamp);
  // Sign-up has no account to read yet and asks the banner directly.
  expect(hasMarketingConsent()).toBe(false);
});
