/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";

import {
  getProjectDiskQuotaWarning,
  ProjectDiskQuotaWarningAlert,
} from "./quota-warning-banner";

jest.mock("./disk-usage", () => ({
  __esModule: true,
  default: ({ buttonText }: { buttonText?: string }) =>
    buttonText ?? "Disk usage",
}));

describe("getProjectDiskQuotaWarning", () => {
  it("does not warn below 80 percent", () => {
    expect(
      getProjectDiskQuotaWarning({
        used: 799_000_000,
        size: 1_000_000_000,
      }),
    ).toBeUndefined();
  });

  it("returns a dismissible warning at 80 percent", () => {
    expect(
      getProjectDiskQuotaWarning({
        used: 800_000_000,
        size: 1_000_000_000,
      }),
    ).toEqual({
      severity: "warning",
      percent: 80,
      remaining: 200_000_000,
      size: 1_000_000_000,
      used: 800_000_000,
    });
  });

  it("raises a severe warning at 90 percent", () => {
    expect(
      getProjectDiskQuotaWarning({
        used: 900_000_000,
        size: 1_000_000_000,
      })?.severity,
    ).toBe("severe");
  });

  it("uses the project startup headroom rule for a blocked warning", () => {
    expect(
      getProjectDiskQuotaWarning({
        used: 990_000_000,
        size: 1_000_000_000,
      })?.severity,
    ).toBe("blocked");
  });

  it("ignores invalid or unavailable quota limits", () => {
    expect(
      getProjectDiskQuotaWarning({
        used: 100,
        size: 0,
      }),
    ).toBeUndefined();
  });
});

describe("ProjectDiskQuotaWarningAlert", () => {
  it("lets users dismiss the 80 percent warning but reappears at 90 percent", () => {
    const { container, rerender } = render(
      createElement(ProjectDiskQuotaWarningAlert, {
        project_id: "project-1",
        quota: {
          used: 800_000_000,
          size: 1_000_000_000,
        },
      }),
    );

    expect(screen.getByText("Project storage is 80% full")).toBeTruthy();
    const close = container.querySelector<HTMLButtonElement>(
      "button.ant-alert-close-icon",
    );
    expect(close).not.toBeNull();
    fireEvent.click(close!);
    expect(screen.queryByText("Project storage is 80% full")).toBeNull();

    rerender(
      createElement(ProjectDiskQuotaWarningAlert, {
        project_id: "project-1",
        quota: {
          used: 900_000_000,
          size: 1_000_000_000,
        },
      }),
    );
    expect(screen.getByText("Project storage is 90% full")).toBeTruthy();
  });
});
