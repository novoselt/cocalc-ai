/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import type { RootfsImageEntry } from "@cocalc/util/rootfs-images";

import { RootfsCatalogPicker } from "./catalog-picker";

jest.mock("@cocalc/frontend/rootfs/scan-status", () => ({
  RootfsScanStatusTag: () => null,
}));

function image(id: string, label: string): RootfsImageEntry {
  return {
    id,
    label,
    image: `cocalc.local/rootfs/${id}`,
    description: `${label} environment`,
  };
}

describe("RootfsCatalogPicker", () => {
  it("searches and selects the same catalog cards used by project creation", () => {
    const onSelect = jest.fn();
    render(
      <RootfsCatalogPicker
        images={[image("sage", "SageMath"), image("python", "Python")]}
        onSelect={onSelect}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "sage" },
    });
    expect(screen.getByText("SageMath")).toBeInTheDocument();
    expect(screen.queryByText("Python")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /SageMath/ }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sage" }),
    );
  });
});
