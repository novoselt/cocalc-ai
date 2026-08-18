/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@cocalc/frontend/components", () => ({
  Icon: () => null,
  Tooltip: ({ children }) => <>{children}</>,
}));

jest.mock("./frame-type-toggle", () => ({
  SwitchToClassicButton: () => null,
}));

jest.mock("./studio-help", () => ({
  __esModule: true,
  default: () => null,
}));

import { StudioControls } from "./studio-controls";

function renderControls(overrides: any = {}) {
  const onReadingModeChange = jest.fn();
  render(
    <StudioControls
      availableLayouts={["wide", "comfortable", "narrow"]}
      onLayoutChange={jest.fn()}
      onReadingModeChange={onReadingModeChange}
      studioLayout="comfortable"
      {...overrides}
    />,
  );
  return { onReadingModeChange };
}

describe("Studio reading mode switch", () => {
  it("names the switch, so the visible label is not the only cue", () => {
    renderControls();
    const toggle = screen.getByRole("switch", { name: "Reading" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("reports the current state through the switch role", () => {
    renderControls({ readingMode: true });
    expect(
      screen
        .getByRole("switch", { name: "Reading" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("toggles from the keyboard", () => {
    const { onReadingModeChange } = renderControls();
    const toggle = screen.getByRole("switch", { name: "Reading" });

    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    // antd renders the switch as a button, so Space and Enter both raise a
    // click; assert the resulting call rather than the key handler.
    fireEvent.click(toggle);
    expect(onReadingModeChange).toHaveBeenCalledWith(true);
  });

  it("toggles when the visible label is clicked", () => {
    const { onReadingModeChange } = renderControls({ readingMode: true });

    fireEvent.click(screen.getByText("Reading"));
    expect(onReadingModeChange).toHaveBeenCalledWith(false);
  });

  it("omits the switch entirely when reading mode is unavailable", () => {
    renderControls({ onReadingModeChange: undefined });
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
