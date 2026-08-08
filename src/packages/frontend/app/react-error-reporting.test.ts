/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  COCALC_REACT_ERROR_EVENT,
  COCALC_REACT_ROOT_READY_EVENT,
  enableManagedReactErrorHandling,
  markCaughtReactError,
  reactRootErrorHandlers,
  type ReactErrorEventDetail,
} from "./react-error-reporting";

describe("React root error reporting", () => {
  it("includes boundary scope after componentDidCatch annotates an error", async () => {
    const error = new Error("row failed");
    const details: ReactErrorEventDetail[] = [];
    const listener = (event: Event) => {
      details.push((event as CustomEvent<ReactErrorEventDetail>).detail);
    };
    window.addEventListener(COCALC_REACT_ERROR_EVENT, listener);

    reactRootErrorHandlers.onCaughtError(error, {
      componentStack: "\n at ProjectsTable",
    });
    markCaughtReactError(error, "projects.list", {
      action: "auto-retry",
      retryCount: 0,
    });
    await Promise.resolve();

    expect(details).toEqual([
      {
        kind: "caught",
        error,
        componentStack: "\n at ProjectsTable",
        boundaryScope: "projects.list",
        boundaryAction: "auto-retry",
        boundaryRetryCount: 0,
      },
    ]);
    window.removeEventListener(COCALC_REACT_ERROR_EVENT, listener);
  });

  it("classifies root and recoverable errors and announces managed mode", () => {
    const details: ReactErrorEventDetail[] = [];
    const errors = (event: Event) => {
      details.push((event as CustomEvent<ReactErrorEventDetail>).detail);
    };
    const ready = jest.fn();
    window.addEventListener(COCALC_REACT_ERROR_EVENT, errors);
    window.addEventListener(COCALC_REACT_ROOT_READY_EVENT, ready);

    enableManagedReactErrorHandling();
    reactRootErrorHandlers.onRecoverableError(new Error("recovered"), {
      componentStack: null,
    });
    reactRootErrorHandlers.onUncaughtError(new Error("fatal"), {
      componentStack: "\n at Root",
    });

    expect(ready).toHaveBeenCalledTimes(1);
    expect(details.map(({ kind }) => kind)).toEqual([
      "recoverable",
      "uncaught",
    ]);

    window.removeEventListener(COCALC_REACT_ERROR_EVENT, errors);
    window.removeEventListener(COCALC_REACT_ROOT_READY_EVENT, ready);
  });
});
