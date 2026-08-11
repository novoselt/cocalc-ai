/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { render, screen } from "@testing-library/react";

import { LazyRootFilesystemImageModal } from "./lazy-root-filesystem-image-modal";

const mockModal = jest.fn(({ open }: { open: boolean }) =>
  open ? <div data-testid="rootfs-modal">RootFS settings</div> : null,
);

jest.mock("./root-filesystem-image", () => ({
  RootFilesystemImageModal: (props: { onClose: () => void; open: boolean }) =>
    mockModal(props),
}));

describe("LazyRootFilesystemImageModal", () => {
  it("does not load its implementation until the modal opens", async () => {
    const onClose = jest.fn();
    const { rerender } = render(
      <LazyRootFilesystemImageModal onClose={onClose} open={false} />,
    );

    expect(mockModal).not.toHaveBeenCalled();
    rerender(<LazyRootFilesystemImageModal onClose={onClose} open />);
    expect(await screen.findByTestId("rootfs-modal")).toBeInTheDocument();
    expect(mockModal).toHaveBeenCalledWith({ onClose, open: true });
  });
});
