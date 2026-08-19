/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

let resolveRun: (() => void) | undefined;
const run = jest.fn(
  (_config: unknown) =>
    new Promise<void>((resolve) => {
      resolveRun = resolve;
    }),
);

jest.mock("vanilla-cookieconsent", () => ({
  run: (config: unknown) => run(config),
}));

import { initCookieConsent } from "./init";
import { isBannerReady } from "./state";

it("centers the consent dialog and becomes ready after initialization", async () => {
  Object.defineProperty(navigator, "webdriver", {
    configurable: true,
    value: true,
  });
  initCookieConsent({ enabled: true });

  expect(run).toHaveBeenCalledTimes(1);
  const config = run.mock.calls[0][0] as {
    guiOptions: { consentModal: { position: string } };
    hideFromBots: boolean;
  };
  expect(config.guiOptions.consentModal.position).toBe("middle center");
  expect(config.hideFromBots).toBe(false);
  expect(isBannerReady()).toBe(false);

  resolveRun?.();
  await Promise.resolve();

  expect(isBannerReady()).toBe(true);
});

it("offers marketing email consent as its own section", () => {
  // initCookieConsent only runs once per module instance.
  jest.isolateModules(() => {
    const { initCookieConsent: init } = require("./init");
    init({ enabled: true, categoryDefaults: { marketing: true } });
  });

  const config = run.mock.calls[run.mock.calls.length - 1][0] as {
    categories: Record<string, { enabled: boolean; readOnly: boolean }>;
    language: {
      translations: {
        en: {
          consentModal: { description: string };
          preferencesModal: { sections: { title?: string }[] };
        };
      };
    };
  };
  // Signed-in subscribers must not see their existing choice as switched off.
  expect(config.categories.marketing).toEqual({
    enabled: true,
    readOnly: false,
  });
  expect(config.categories.analytics.enabled).toBe(false);
  expect(config.language.translations.en.consentModal.description).toContain(
    "Accept all",
  );
  expect(
    config.language.translations.en.preferencesModal.sections.map(
      (section) => section.title,
    ),
  ).toEqual(
    expect.arrayContaining([
      "Communication preferences",
      "Onboarding and marketing emails",
    ]),
  );
});
