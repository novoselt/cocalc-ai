/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { render } from "@testing-library/react";
import { fromJS } from "immutable";

jest.mock("../use-blob", () => ({
  __esModule: true,
  default: () => "blob:pdf-output",
}));

// The readonly viewer may load after the full frontend and replace the global
// MIME handler. The replacement must retain support for live blob-backed data.
import "../mime-types/pdf";
import "../mime-types/simple-pdf";
import { getHandler } from "../mime-types/register";

const message = fromJS({});
const data = fromJS({});

describe("PDF MIME handler", () => {
  it("renders a live notebook SHA-1 value after readonly registration", () => {
    const Handler = getHandler("application/pdf");
    const { container } = render(
      <Handler
        actions={{ asyncBlobStore: {} } as any}
        data={data}
        message={message}
        type="application/pdf"
        value="0123456789012345678901234567890123456789"
      />,
    );

    expect(container.querySelector("embed")).toHaveAttribute(
      "src",
      "blob:pdf-output",
    );
  });

  it("renders readonly inline PDF data", () => {
    const Handler = getHandler("application/pdf");
    const { container } = render(
      <Handler
        data={data}
        message={message}
        type="application/pdf"
        value={fromJS({ value: "base64-pdf" })}
      />,
    );

    expect(container.querySelector("embed")).toHaveAttribute(
      "src",
      "data:application/pdf;base64,base64-pdf",
    );
  });
});
