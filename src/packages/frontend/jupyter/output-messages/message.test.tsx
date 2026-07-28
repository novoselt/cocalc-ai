/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { render, screen } from "@testing-library/react";
import { fromJS } from "immutable";

import { CellOutputMessages } from "./message";

describe("CellOutputMessages lifecycle", () => {
  it("renders AI error help after the Jupyter store is removed", () => {
    const AIError = ({ input, traceback }) => (
      <div data-testid="ai-error">
        {input}:{traceback}
      </div>
    );

    render(
      <CellOutputMessages
        output={fromJS({
          "0": {
            traceback: ["ValueError: bad value"],
          },
        })}
        actions={{ store: undefined }}
        id="cell-id"
        aiTools={{ toolComponents: { AIError } } as any}
      />,
    );

    expect(screen.getByTestId("ai-error")).toHaveTextContent(
      ":ValueError: bad value",
    );
  });
});
