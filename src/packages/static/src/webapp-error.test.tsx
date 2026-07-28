/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { act } from "react";

jest.mock("./crash", () => ({
  __esModule: true,
  default: () => <div id="cocalc-react-crash" style={{ display: "none" }} />,
}));

jest.mock("./crash-message", () => ({
  __esModule: true,
  default: () => <div>Crash details</div>,
}));

import initError from "./webapp-error";

describe("webapp crash screen", () => {
  it("does not suppress a later-installed error reporter", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = `
      <div id="cocalc-crash-container"></div>
      <div id="cocalc-error-report-startup"></div>
    `;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await act(async () => {
      initError();
    });

    const reporter = jest.fn(() => true);
    window.onerror = reporter;
    const error = new Error(
      "Cannot read properties of undefined (reading '/tmp/test.sage-chat')",
    );
    act(() => {
      window.dispatchEvent(
        new ErrorEvent("error", {
          error,
          message: error.message,
          filename: "https://cocalc.test/static/app.js",
          lineno: 42,
          colno: 7,
        }),
      );
    });

    expect(reporter).toHaveBeenCalledTimes(1);
    expect(window.onerror).toBe(reporter);
    expect(document.getElementById("cocalc-react-crash")?.style.display).toBe(
      "block",
    );

    window.onerror = null;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
    warn.mockRestore();
  });
});
