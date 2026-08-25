/** @jest-environment jsdom */

import { Map, fromJS } from "immutable";
import { fireEvent, render, screen } from "@testing-library/react";

import { CellInput } from "../cell-input";

let latestMarkdownInputProps: any = null;

jest.mock("@cocalc/frontend/app-framework", () => {
  const React = require("react");
  return {
    React,
    redux: {
      getStore: () => ({
        hasLanguageModelEnabled: () => false,
      }),
    },
  };
});

jest.mock("@cocalc/frontend/components/hidden-visible", () => ({
  HiddenXS: ({ children }) => <>{children}</>,
}));

jest.mock("@cocalc/frontend/editors/markdown-input/multimode", () => ({
  __esModule: true,
  default: (props: any) => {
    latestMarkdownInputProps = props;
    return <div data-testid="markdown-input" />;
  },
}));

jest.mock("@cocalc/frontend/editors/slate/mostly-static-markdown", () => ({
  __esModule: true,
  default: ({ value }) => <div>{value}</div>,
}));

jest.mock(
  "@cocalc/frontend/frame-editors/jupyter-editor/cell-notebook/hook",
  () => ({
    __esModule: true,
    default: () => ({
      current: {
        adjacentCell: jest.fn(),
        register_input_editor: jest.fn(),
        set_cur_id: jest.fn(),
        set_md_cell_not_editing: jest.fn(),
        set_mode: jest.fn(),
        unselect_all_cells: jest.fn(),
        unregister_input_editor: jest.fn(),
      },
    }),
  }),
);

jest.mock("@cocalc/frontend/lib/file-context", () => {
  const React = require("react");
  const FileContext = React.createContext({});
  return {
    FileContext,
    useFileContext: () => ({
      disableExtraButtons: true,
      urlTransform: (url: string) => url,
    }),
  };
});

jest.mock("../cell-buttonbar", () => ({
  CellButtonBar: () => null,
}));

jest.mock("../cell-hidden-part", () => ({
  CellHiddenPart: ({ onReveal, revealLabel }) =>
    onReveal == null ? (
      <span data-testid="hidden-cell-input" />
    ) : (
      <button aria-label={revealLabel} onClick={onReveal} type="button" />
    ),
}));

jest.mock("../cell-toolbar", () => ({
  CellToolbar: () => null,
}));

jest.mock("../codemirror-component", () => ({
  CodeMirror: () => null,
}));

jest.mock("../prompt/input", () => ({
  InputPrompt: () => null,
}));

jest.mock("../run-cell-overlay", () => ({
  getDisplayedCellExecCount: () => null,
}));

describe("Jupyter cell input", () => {
  beforeEach(() => {
    latestMarkdownInputProps = null;
  });

  it("lets Slate markdown cells grow with notebook content instead of using an internal capped scroller", () => {
    render(
      <CellInput
        cell={
          fromJS({
            id: "cell-1",
            cell_type: "markdown",
            input: "# A long markdown cell",
            metadata: {},
          }) as Map<string, any>
        }
        cm_options={
          fromJS({
            markdown: {},
            options: {},
          }) as Map<string, any>
        }
        id="cell-1"
        index={0}
        is_markdown_edit={true}
        is_focused={true}
        is_current={true}
        font_size={14}
        is_readonly={false}
        input_is_readonly={false}
      />,
    );

    expect(latestMarkdownInputProps).toBeTruthy();
    expect(latestMarkdownInputProps.height).toBe("auto");
    expect(latestMarkdownInputProps.unboundedAutoGrow).toBe(true);
    expect(latestMarkdownInputProps.undoMode).toBe("local");
    expect(latestMarkdownInputProps.redoMode).toBe("local");
  });

  it("does not autofocus a markdown editor merely because the cell is current", () => {
    const { rerender } = render(
      <CellInput
        cell={
          fromJS({
            id: "cell-1",
            cell_type: "markdown",
            input: "# Markdown",
            metadata: {},
          }) as Map<string, any>
        }
        cm_options={
          fromJS({
            markdown: {},
            options: {},
          }) as Map<string, any>
        }
        id="cell-1"
        index={0}
        is_markdown_edit={true}
        is_focused={false}
        is_current={true}
        font_size={14}
        is_readonly={false}
        input_is_readonly={false}
      />,
    );

    expect(latestMarkdownInputProps.autoFocus).toBe(false);

    rerender(
      <CellInput
        cell={
          fromJS({
            id: "cell-1",
            cell_type: "markdown",
            input: "# Markdown",
            metadata: {},
          }) as Map<string, any>
        }
        cm_options={
          fromJS({
            markdown: {},
            options: {},
          }) as Map<string, any>
        }
        id="cell-1"
        index={0}
        is_markdown_edit={true}
        is_focused={true}
        is_current={true}
        font_size={14}
        is_readonly={false}
        input_is_readonly={false}
      />,
    );

    expect(latestMarkdownInputProps.autoFocus).toBe(true);
  });
});

describe("Jupyter hidden cell input", () => {
  const cmOptions = fromJS({
    markdown: {},
    options: {},
  }) as Map<string, any>;

  function hiddenCell(id: string) {
    return fromJS({
      id,
      cell_type: "code",
      input: `print(${JSON.stringify(id)})`,
      metadata: { jupyter: { source_hidden: true } },
    }) as Map<string, any>;
  }

  it("reveals only the hidden cell whose ellipsis is clicked", () => {
    const set_jupyter_metadata = jest.fn();
    const actions = { set_jupyter_metadata } as any;

    render(
      <>
        <CellInput
          actions={actions}
          cell={hiddenCell("cell-1")}
          cm_options={cmOptions}
          font_size={14}
          id="cell-1"
          index={0}
          input_is_readonly={false}
          is_current={false}
          is_focused={false}
          is_markdown_edit={false}
          is_readonly={false}
        />
        <CellInput
          actions={actions}
          cell={hiddenCell("cell-2")}
          cm_options={cmOptions}
          font_size={14}
          id="cell-2"
          index={1}
          input_is_readonly={false}
          is_current={false}
          is_focused={false}
          is_markdown_edit={false}
          is_readonly={false}
        />
      </>,
    );

    const revealButtons = screen.getAllByRole("button", {
      name: "Show hidden cell input",
    });
    revealButtons[1].focus();
    expect(revealButtons[1]).toHaveFocus();
    fireEvent.click(revealButtons[1]);

    expect(set_jupyter_metadata).toHaveBeenCalledTimes(1);
    expect(set_jupyter_metadata).toHaveBeenCalledWith(
      "cell-2",
      "source_hidden",
      undefined,
    );
  });

  it("does not offer a reveal action in a read-only notebook", () => {
    render(
      <CellInput
        actions={{ set_jupyter_metadata: jest.fn() } as any}
        cell={hiddenCell("cell-1")}
        cm_options={cmOptions}
        font_size={14}
        id="cell-1"
        index={0}
        input_is_readonly={false}
        is_current={false}
        is_focused={false}
        is_markdown_edit={false}
        is_readonly
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Show hidden cell input" }),
    ).toBeNull();
  });
});
