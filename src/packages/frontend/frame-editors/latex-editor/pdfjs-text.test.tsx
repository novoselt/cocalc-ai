/** @jest-environment jsdom */

import { render, waitFor } from "@testing-library/react";

const mockTextLayerRender = jest.fn();
const mockTextLayerCancel = jest.fn();

jest.mock("pdfjs-dist", () => ({
  TextLayer: jest.fn().mockImplementation(() => ({
    render: mockTextLayerRender,
    cancel: mockTextLayerCancel,
  })),
}));

import PdfjsTextLayer from "./pdfjs-text";

describe("PdfjsTextLayer", () => {
  beforeEach(() => {
    mockTextLayerRender.mockReset();
    mockTextLayerCancel.mockReset();
  });

  it("handles malformed PDF text without an unhandled rejection", async () => {
    const err = new Error("Bad (uncompressed) XRef entry: 18R");
    mockTextLayerRender.mockRejectedValue(err);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const page = {
      streamTextContent: jest.fn(() => ({})),
    };

    const { unmount } = render(
      <PdfjsTextLayer page={page as any} scale={1} viewport={{}} />,
    );

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        `pdf.js -- Error rendering text layer: ${err}`,
      ),
    );
    unmount();
    expect(mockTextLayerCancel).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
