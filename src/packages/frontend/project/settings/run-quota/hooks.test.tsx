/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import {
  PLATFORM_MODE_SINGLE_NODE,
  PLATFORM_MODE_ON_PREMISES,
} from "@cocalc/util/db-schema/site-defaults";
import { formatRunQuotaForDisplay, useDisplayedFields } from "./hooks";

let mockPlatformMode = PLATFORM_MODE_SINGLE_NODE;

jest.mock("@cocalc/frontend/app-framework", () => ({
  useEffect: require("react").useEffect,
  useMemo: require("react").useMemo,
  useState: require("react").useState,
  useTypedRedux: (store: string, key: string) => {
    if (store === "customize" && key === "platform_mode") {
      return mockPlatformMode;
    }
    return undefined;
  },
}));

function DisplayedFields() {
  return <div>{useDisplayedFields().join(",")}</div>;
}

describe("run quota displayed fields", () => {
  it("shows cocalc-ai baseline fields on single-node deployments", () => {
    mockPlatformMode = PLATFORM_MODE_SINGLE_NODE;

    render(<DisplayedFields />);

    expect(screen.getByText("disk_quota,memory")).toBeTruthy();
  });

  it("adds on-premises-only extras for on-premises deployments", () => {
    mockPlatformMode = PLATFORM_MODE_ON_PREMISES;

    render(<DisplayedFields />);

    expect(screen.getByText("disk_quota,memory,ext_rw,patch,gpu")).toBeTruthy();
  });
});

describe("run quota formatting", () => {
  it("omits internal project-host scheduling fields", () => {
    const result = formatRunQuotaForDisplay({
      cpu_limit: 2,
      network: true,
      io_class: "standard",
      shared_compute_priority: 400,
    });

    expect(result.cpu_limit).toBe("2 cores");
    expect(result.network).toBe(true);
    expect(result).not.toHaveProperty("io_class");
    expect(result).not.toHaveProperty("shared_compute_priority");
  });
});
