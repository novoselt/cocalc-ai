/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";

import type { RootfsImageEntry } from "@cocalc/util/rootfs-images";

import {
  getProjectRootfsUpgrade,
  ProjectRootfsUpgradeAlert,
} from "./rootfs-upgrade-banner";

jest.mock("@cocalc/frontend/project/settings/root-filesystem-image", () => ({
  RootFilesystemImageModal: () => null,
}));

function image(
  id: string,
  version: string,
  opts: Partial<RootfsImageEntry> = {},
): RootfsImageEntry {
  return {
    id,
    image: `cocalc.local/rootfs/${id}`,
    label: "CoCalc Basic",
    family: "ubuntu",
    version,
    channel: "stable",
    ...opts,
  };
}

describe("getProjectRootfsUpgrade", () => {
  it("finds the current catalog entry by id and returns its latest upgrade", () => {
    const current = image("basic-1.6", "1.6");
    const next = image("basic-1.7", "1.7", {
      supersedes_image_id: current.id,
    });

    expect(
      getProjectRootfsUpgrade({
        imageId: current.id,
        images: [current, next],
      }),
    ).toEqual({ current, next });
  });

  it("falls back to the runtime image name for projects without an image id", () => {
    const current = image("basic-1.6", "1.6");
    const next = image("basic-1.7", "1.7");

    expect(
      getProjectRootfsUpgrade({
        image: current.image,
        images: [current, next],
      })?.next.id,
    ).toBe(next.id);
  });
});

describe("ProjectRootfsUpgradeAlert", () => {
  it("opens the review flow and can be dismissed until a new upgrade appears", () => {
    const current = image("basic-1.6", "1.6");
    const next = image("basic-1.7", "1.7");
    const newer = image("basic-1.8", "1.8");
    const onReview = jest.fn();
    const { container, rerender } = render(
      <ProjectRootfsUpgradeAlert
        current={current}
        next={next}
        onReview={onReview}
        project_id="project-1"
      />,
    );

    fireEvent.click(screen.getByText("Review upgrade"));
    expect(onReview).toHaveBeenCalledTimes(1);
    fireEvent.click(
      container.querySelector<HTMLButtonElement>(
        "button.ant-alert-close-icon",
      )!,
    );
    expect(screen.queryByText("A newer project image is available")).toBeNull();

    rerender(
      <ProjectRootfsUpgradeAlert
        current={current}
        next={newer}
        onReview={onReview}
        project_id="project-1"
      />,
    );
    expect(screen.getByText("A newer project image is available")).toBeTruthy();
  });
});
