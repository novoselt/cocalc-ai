/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fromJS, Map } from "immutable";
import { fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "react-intl";

let mockCellOutputProps: any;
let mockMarkdownProps: any;
let mockMarkdownResolvedUrl: any;

jest.mock("@cocalc/frontend/app-framework", () => ({
  React: require("react"),
  CSS: {},
}));

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }) => <span>{name}</span>,
  isIconName: () => true,
  Tooltip: ({ children }) => <>{children}</>,
}));

jest.mock("@cocalc/frontend/i18n", () => ({
  jupyter: {
    commands: {
      run_all_cells_above_menu: {
        id: "test.run_above",
        defaultMessage: "Run all above",
      },
      run_all_cells_below_menu: {
        id: "test.run_below",
        defaultMessage: "Run all below",
      },
    },
  },
}));

jest.mock(
  "@cocalc/frontend/frame-editors/jupyter-editor/cell-notebook/hook",
  () => ({
    __esModule: true,
    default: () => ({ current: undefined }),
  }),
);

jest.mock("@cocalc/frontend/editors/slate/mostly-static-markdown", () => {
  const MockMostlyStaticMarkdown = (props) => {
    mockMarkdownProps = props;
    const { useFileContext } = require("@cocalc/frontend/lib/file-context");
    const ctx = useFileContext();
    mockMarkdownResolvedUrl = ctx.urlTransform?.("attachment:diagram.png");
    return <div data-testid="mostly-static-markdown" />;
  };
  return { __esModule: true, default: MockMostlyStaticMarkdown };
});

jest.mock("@cocalc/frontend/jupyter/cell-output", () => ({
  CellOutput: (props) => {
    mockCellOutputProps = props;
    return <div data-testid="cell-output" />;
  },
}));

jest.mock("@cocalc/frontend/jupyter/cell-toolbar", () => ({
  CellToolbar: () => null,
}));

jest.mock("@cocalc/frontend/jupyter/cell-input", () => ({
  CellInput: () => null,
}));

jest.mock("@cocalc/frontend/jupyter/cell-chat-button", () => ({
  CellChatButton: () => <span data-testid="cell-chat-button" />,
  CellChatCompactButton: () => <span data-testid="cell-chat-compact-button" />,
}));

jest.mock("@cocalc/frontend/jupyter/ai", () => ({
  AgentCellTool: () => null,
}));

jest.mock("@cocalc/frontend/jupyter/cell-buttonbar-menu", () => ({
  CodeBarDropdownMenu: () => null,
}));

jest.mock("./studio-code-preview", () => ({
  StudioCodePreview: () => null,
}));

jest.mock("./studio-gutter", () => ({
  StudioGutter: () => null,
  formatDuration: () => "",
  formatTimeAgo: () => "",
}));

import { StudioCell } from "./studio-cell";

function renderStudioCell(overrides: any = {}) {
  const props = {
    id: "cell-1",
    index: 0,
    cell: fromJS({ id: "cell-1", cell_type: "code", input: "1+1" }),
    cm_options: Map(),
    mode: "escape" as const,
    font_size: 14,
    positionInBlock: 0,
    blockSize: 1,
    headingLevel: 0,
    ...overrides,
  };
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <StudioCell {...props} />
    </IntlProvider>,
  );
}

describe("StudioCell transient output states", () => {
  beforeEach(() => {
    mockCellOutputProps = undefined;
    mockMarkdownProps = undefined;
    mockMarkdownResolvedUrl = undefined;
  });

  it("does not mount CellOutput for a code cell with no output at all", () => {
    renderStudioCell();
    expect(screen.queryByTestId("cell-output")).toBeNull();
  });

  it("mounts CellOutput and forwards stdin when the kernel requests input", () => {
    const stdin = fromJS({ id: "cell-1", prompt: "value: " });
    renderStudioCell({ stdin });
    expect(screen.getByTestId("cell-output")).toBeInTheDocument();
    expect(mockCellOutputProps.stdin).toBe(stdin);
  });

  it("mounts CellOutput and forwards a pending runOverlay", () => {
    const runOverlay = fromJS({ state: "pending" });
    renderStudioCell({ runOverlay, isDragging: true });
    expect(screen.getByTestId("cell-output")).toBeInTheDocument();
    expect(mockCellOutputProps.runOverlay).toBe(runOverlay);
    expect(mockCellOutputProps.isDragging).toBe(true);
  });

  it("does not resize CellOutput when completions are open", () => {
    const cell = fromJS({
      id: "cell-1",
      cell_type: "code",
      input: "1+1",
      output: { 0: { data: { "text/plain": "2" } } },
    });
    renderStudioCell({
      cell,
      is_current: true,
      complete: fromJS({ matches: [] }),
    });
    expect(mockCellOutputProps.complete).toBeUndefined();
  });
});

describe.each([
  ["standard", false],
  ["reading", true],
])("StudioCell compact chat affordance in %s mode", (_label, readingMode) => {
  it("shows only compact chat until the cell is hovered", () => {
    renderStudioCell({
      actions: {},
      read_only: true,
      readingMode,
    });

    expect(screen.getByTestId("cell-chat-compact-button")).toBeInTheDocument();
    expect(screen.queryByTestId("cell-chat-button")).toBeNull();

    fireEvent.mouseEnter(document.getElementById("cell-1")!);

    expect(screen.queryByTestId("cell-chat-compact-button")).toBeNull();
    expect(screen.getByTestId("cell-chat-button")).toBeInTheDocument();
  });
});

describe("StudioCell markdown rendering", () => {
  beforeEach(() => {
    mockCellOutputProps = undefined;
    mockMarkdownProps = undefined;
    mockMarkdownResolvedUrl = undefined;
  });

  const mdCell = fromJS({
    id: "cell-1",
    cell_type: "markdown",
    input: "![diagram](attachment:diagram.png)",
    attachments: {
      "diagram.png": { type: "base64", value: "AAAA" },
    },
  });

  it("runs actions.processRenderedMarkdown before rendering", () => {
    const processRenderedMarkdown = jest.fn(
      ({ value }) => `${value} [processed]`,
    );
    renderStudioCell({
      cell: mdCell,
      actions: { processRenderedMarkdown } as any,
    });
    expect(processRenderedMarkdown).toHaveBeenCalledWith({
      value: "![diagram](attachment:diagram.png)",
      id: "cell-1",
    });
    expect(mockMarkdownProps.value).toBe(
      "![diagram](attachment:diagram.png) [processed]",
    );
  });

  it("provides a urlTransform that resolves notebook attachments", () => {
    renderStudioCell({ cell: mdCell });
    expect(screen.getByTestId("mostly-static-markdown")).toBeInTheDocument();
    expect(mockMarkdownResolvedUrl).toBe("data:image/png;base64,AAAA");
  });
});
