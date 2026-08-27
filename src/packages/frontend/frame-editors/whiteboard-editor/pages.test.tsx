/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { List, Map as iMap } from "immutable";
import { render, screen } from "@testing-library/react";

import Pages from "./pages";

const actions = {
  fitToScreen: jest.fn(),
  mainFrameType: "slides",
  movePage: jest.fn(),
  saveViewport: jest.fn(),
  setPage: jest.fn(),
  setPages: jest.fn(),
  set_active_id: jest.fn(),
  show_focused_frame_of_type: jest.fn(() => "main-frame"),
};

const editorState = {
  is_loaded: true,
  pages: iMap({ page1: iMap() }),
  elements: iMap(),
  sortedPageIds: List(["page1"]),
};

jest.mock("use-resize-observer", () => () => ({}));

jest.mock("@cocalc/frontend/app-framework", () => ({
  useEditorRedux: () => (key: keyof typeof editorState) => editorState[key],
}));

jest.mock("@cocalc/frontend/components", () => ({
  Loading: () => <div>Loading</div>,
}));

jest.mock("@cocalc/frontend/components/stateful-virtuoso", () => ({
  __esModule: true,
  default: ({ itemContent, totalCount }: any) => (
    <div>
      {Array.from({ length: totalCount }, (_, index) => itemContent(index))}
    </div>
  ),
}));

jest.mock("@cocalc/frontend/components/sortable-list", () => ({
  DragHandle: () => <span data-testid="drag-handle" />,
  SortableItem: ({ children }: any) => <>{children}</>,
  SortableList: ({ children }: any) => <>{children}</>,
}));

jest.mock("./actions", () => ({ elementsList: () => [] }));

jest.mock("./delete-page", () => ({
  __esModule: true,
  default: () => <button>Delete</button>,
}));

jest.mock("./hooks", () => ({
  useFrameContext: () => ({
    actions,
    desc: iMap({ id: "pages-frame" }),
    id: "pages-frame",
    path: "presentation.slides",
    project_id: "project-id",
  }),
}));

jest.mock("./new-page", () => ({
  __esModule: true,
  AddPage: () => <button>Insert</button>,
  default: () => <div>New Page</div>,
}));

jest.mock("./tools/navigation", () => ({
  Overview: ({ width }: { width: number }) => (
    <div data-testid="page-preview" style={{ width }} />
  ),
}));

describe("whiteboard pages layout", () => {
  it("keeps page controls below the preview and inside the item width", () => {
    render(<Pages />);

    const item = screen.getByTestId("whiteboard-page-item");
    const previewRow = screen.getByTestId("whiteboard-page-preview-row");
    const controls = screen.getByTestId("whiteboard-page-controls");

    expect(item).toHaveStyle({
      boxSizing: "border-box",
      overflow: "hidden",
      width: "calc(100% - 0px)",
    });
    expect(previewRow.nextElementSibling).toBe(controls);
    expect(previewRow).not.toContainElement(controls);
    expect(controls).toHaveStyle({
      display: "flex",
      justifyContent: "flex-end",
    });
  });
});
