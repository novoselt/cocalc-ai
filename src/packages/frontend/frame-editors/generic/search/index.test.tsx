/** @jest-environment jsdom */

import { render, waitFor } from "@testing-library/react";
import { Map } from "immutable";

import { useFrameContext } from "@cocalc/frontend/frame-editors/frame-tree/frame-context";
import useSearchIndex from "./use-search-index";
import { createSearchEditor } from "./index";

jest.mock("@cocalc/frontend/frame-editors/frame-tree/frame-context", () => ({
  useFrameContext: jest.fn(),
}));

jest.mock("./use-search-index", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@cocalc/frontend/app-framework", () => ({
  useRedux: jest.fn(() => undefined),
}));

describe("generic editor search", () => {
  const useFrameContextMock = useFrameContext as jest.Mock;
  const useSearchIndexMock = useSearchIndex as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    useFrameContextMock.mockReturnValue({
      actions: {
        isClosed: () => false,
        name: "editor",
        set_frame_data: jest.fn(),
      },
      id: "search-frame",
      path: "document.chat",
      project_id: "project-1",
    });
  });

  it("contains a stale index rejection", async () => {
    const setError = jest.fn();
    const index = {
      search: jest.fn(async () => {
        throw Error("index not ready");
      }),
    };
    useSearchIndexMock.mockReturnValue({
      doRefresh: jest.fn(),
      error: "",
      fragmentKey: "id",
      index,
      isIndexing: false,
      reduxName: "editor",
      setError,
    });
    const Search = createSearchEditor({
      updateField: "messages",
    }).component as any;

    render(<Search desc={Map({ "data-search": "needle" })} font_size={14} />);

    await waitFor(() => {
      expect(index.search).toHaveBeenCalledWith({
        term: "needle",
        limit: 30,
      });
      expect(setError).toHaveBeenCalledWith("Error: index not ready");
    });
  });
});
