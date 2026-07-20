import { render, waitFor } from "@testing-library/react";
import { fromJS } from "immutable";

import { NBConvert } from "./nbconvert";

const downloadFile = jest.fn();
const getProjectStore = jest.fn(() => ({
  fileURL: (path: string) => `/files/${path}`,
}));

jest.mock("antd", () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Modal: ({ children, open }: any) => (open ? <div>{children}</div> : null),
}));

jest.mock("@cocalc/frontend/app-framework", () => ({
  redux: {
    getProjectActions: () => ({ download_file: downloadFile }),
    getProjectStore: (...args: any[]) => getProjectStore(...args),
  },
}));

jest.mock("@cocalc/frontend/components", () => ({
  A: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  Icon: ({ name }: any) => <span>{name}</span>,
  Loading: () => <span>loading</span>,
  TimeAgo: () => <span>recently</span>,
}));

jest.mock("@cocalc/frontend/components/progress-estimate", () => () => null);

function createActions(fileExtension = ".py") {
  return {
    project_id: "project-1",
    store: {
      get_language_info: () => ({ file_extension: fileExtension }),
    },
    focus: jest.fn(),
    nbconvert: jest.fn(),
    setState: jest.fn(),
  } as any;
}

describe("NBConvert", () => {
  beforeEach(() => {
    downloadFile.mockReset();
    getProjectStore.mockClear();
  });

  it("starts executable script export without requesting obsolete backend kernel info", async () => {
    const actions = createActions();

    render(
      <NBConvert
        actions={actions}
        path="notebook.ipynb"
        project_id="project-1"
        nbconvert_dialog={fromJS({ to: "script" })}
      />,
    );

    await waitFor(() => {
      expect(actions.nbconvert).toHaveBeenCalledWith(["--to", "script"]);
    });
  });

  it("downloads an exported script using the notebook language extension", async () => {
    const actions = createActions(".R");
    const dialog = fromJS({ to: "script" });
    const { rerender } = render(
      <NBConvert
        actions={actions}
        path="analysis.ipynb"
        project_id="project-1"
        nbconvert={fromJS({ state: "run" })}
        nbconvert_dialog={dialog}
      />,
    );

    rerender(
      <NBConvert
        actions={actions}
        path="analysis.ipynb"
        project_id="project-1"
        nbconvert={fromJS({
          state: "done",
          args: ["--to", "script"],
          time: Date.now(),
        })}
        nbconvert_dialog={dialog}
      />,
    );

    await waitFor(() => {
      expect(downloadFile).toHaveBeenCalledWith({ path: "analysis.R" });
    });
  });
});
