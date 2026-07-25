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
  initCookieConsent({ enabled: true });

  expect(run).toHaveBeenCalledTimes(1);
  const config = run.mock.calls[0][0] as {
    guiOptions: { consentModal: { position: string } };
  };
  expect(config.guiOptions.consentModal.position).toBe("middle center");
  expect(isBannerReady()).toBe(false);

  resolveRun?.();
  await Promise.resolve();

  expect(isBannerReady()).toBe(true);
});
