/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CocalcErrorBoundary } from "./error-boundary";
import {
  COCALC_REACT_ERROR_EVENT,
  reactRootErrorHandlers,
  type ReactErrorEventDetail,
} from "./react-error-reporting";

describe("CocalcErrorBoundary", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("automatically remounts a subtree once after a transient render error", async () => {
    let failures = 0;
    function TransientFailure() {
      // React retries a concurrent render once before consulting the nearest
      // boundary. Fail both attempts, then let the boundary retry succeed.
      if (failures < 2) {
        failures += 1;
        throw new Error("transient");
      }
      return <div>Recovered content</div>;
    }

    render(
      <CocalcErrorBoundary autoRetry scope="test.transient">
        <TransientFailure />
      </CocalcErrorBoundary>,
      {
        onCaughtError: () => {},
        onRecoverableError: () => {},
      },
    );

    expect(await screen.findByText("Recovered content")).toBeInTheDocument();
    expect(
      screen.queryByText("This part of CoCalc could not be displayed."),
    ).not.toBeInTheDocument();
  });

  it("does not automatically remount a failed subtree by default", async () => {
    let failures = 0;
    function Failure() {
      failures += 1;
      throw new Error("persistent");
    }

    render(
      <CocalcErrorBoundary scope="test.manual">
        <Failure />
      </CocalcErrorBoundary>,
      {
        onCaughtError: () => {},
        onRecoverableError: () => {},
      },
    );

    expect(
      await screen.findByText("This part of CoCalc could not be displayed."),
    ).toBeInTheDocument();
    const failuresAfterFallback = failures;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(failures).toBe(failuresAfterFallback);
  });

  it("shows a local fallback and supports a manual retry", async () => {
    let shouldThrow = true;
    const reports: ReactErrorEventDetail[] = [];
    const listener = (event: Event) => {
      reports.push((event as CustomEvent<ReactErrorEventDetail>).detail);
    };
    window.addEventListener(COCALC_REACT_ERROR_EVENT, listener);

    function PersistentFailure() {
      if (shouldThrow) {
        throw new Error("persistent");
      }
      return <div>Working again</div>;
    }

    render(
      <CocalcErrorBoundary scope="projects.list">
        <PersistentFailure />
      </CocalcErrorBoundary>,
      {
        onCaughtError: reactRootErrorHandlers.onCaughtError,
        onRecoverableError: () => {},
      },
    );

    expect(
      await screen.findByText("This part of CoCalc could not be displayed."),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-error-boundary="projects.list"]'),
    ).not.toBeNull();
    await waitFor(() => {
      expect(reports.length).toBeGreaterThan(0);
    });
    expect(
      reports.every(({ boundaryScope }) => boundaryScope === "projects.list"),
    ).toBe(true);

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(screen.getByText("Working again")).toBeInTheDocument();
    });
    window.removeEventListener(COCALC_REACT_ERROR_EVENT, listener);
  });

  it("resets a failed region when its navigation key changes", async () => {
    function Content({ route }: { route: string }) {
      if (route === "broken") {
        throw new Error("broken route");
      }
      return <div>Healthy route</div>;
    }

    const { rerender } = render(
      <CocalcErrorBoundary
        autoRetry={false}
        resetKeys={["broken"]}
        scope="app.active-content"
      >
        <Content route="broken" />
      </CocalcErrorBoundary>,
      {
        onCaughtError: () => {},
        onRecoverableError: () => {},
      },
    );

    expect(
      await screen.findByText("This part of CoCalc could not be displayed."),
    ).toBeInTheDocument();

    rerender(
      <CocalcErrorBoundary
        autoRetry={false}
        resetKeys={["healthy"]}
        scope="app.active-content"
      >
        <Content route="healthy" />
      </CocalcErrorBoundary>,
    );

    expect(await screen.findByText("Healthy route")).toBeInTheDocument();
  });
});
