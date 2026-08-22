/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { render, screen } from "@testing-library/react";

import {
  browserIdleTimeoutFromRunQuota,
  BrowserRuntimeLimitBanner,
  formatBrowserIdleTimeout,
} from "./browser-runtime-limit-banner";

describe("BrowserRuntimeLimitBanner", () => {
  it("shows the policy timer and accessible upgrade path", () => {
    render(<BrowserRuntimeLimitBanner timeoutSeconds={1800} />);

    expect(screen.getByText("Free project runtime")).toBeTruthy();
    expect(screen.getByLabelText("Browser idle timeout 30:00")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Upgrade for background runtime" }),
    ).toHaveAttribute("href", "/settings/membership");
    expect(screen.getByText(/files are preserved/)).toBeTruthy();
  });

  it("formats hour and second policies", () => {
    expect(formatBrowserIdleTimeout(3600)).toEqual({
      clock: "1:00:00",
      description: "1 hour",
    });
    expect(formatBrowserIdleTimeout(90)).toEqual({
      clock: "1:30",
      description: "90 seconds",
    });
  });

  it("only enables presence for an explicit positive browser timeout", () => {
    expect(browserIdleTimeoutFromRunQuota({ browser_idle_timeout: 1800 })).toBe(
      1800,
    );
    expect(
      browserIdleTimeoutFromRunQuota({
        get: (key: string) => (key === "browser_idle_timeout" ? 90 : undefined),
      }),
    ).toBe(90);
    expect(browserIdleTimeoutFromRunQuota({ idle_timeout: 1800 })).toBe(0);
    expect(browserIdleTimeoutFromRunQuota({ browser_idle_timeout: 0 })).toBe(0);
  });
});
