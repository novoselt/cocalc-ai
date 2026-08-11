import { EventEmitter } from "events";
import { act, render } from "@testing-library/react";
import { useProjectStartStateReconcile } from "./use-project-start-state-reconcile";

jest.useFakeTimers();

const mockReconcileProjectStartState = jest.fn(async () => undefined);

jest.mock("@cocalc/frontend/app-framework", () => ({
  redux: {
    getActions: jest.fn(() => ({
      reconcile_project_start_state: mockReconcileProjectStartState,
    })),
  },
}));

jest.mock("@cocalc/frontend/webapp-client", () => {
  const { EventEmitter } = require("events");
  return {
    webapp_client: {
      conat_client: Object.assign(new EventEmitter(), {
        removeListener: EventEmitter.prototype.removeListener,
      }),
    },
  };
});

const { webapp_client } = jest.requireMock(
  "@cocalc/frontend/webapp-client",
) as {
  webapp_client: {
    conat_client: EventEmitter & {
      removeListener: typeof EventEmitter.prototype.removeListener;
    };
  };
};

function TestComponent({ enabled = true }: { enabled?: boolean }) {
  useProjectStartStateReconcile({ project_id: "project-1", enabled });
  return null;
}

describe("useProjectStartStateReconcile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    webapp_client.conat_client.removeAllListeners();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("checks immediately and periodically while startup is active", async () => {
    render(<TestComponent />);
    await act(async () => Promise.resolve());
    expect(mockReconcileProjectStartState).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(8_000);
    });
    expect(mockReconcileProjectStartState).toHaveBeenCalledTimes(3);
  });

  it("does not poll while disabled", async () => {
    render(<TestComponent enabled={false} />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(8_000);
    });
    expect(mockReconcileProjectStartState).not.toHaveBeenCalled();
  });

  it("pauses while hidden and checks when the browser becomes visible", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    render(<TestComponent />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(8_000);
    });
    expect(mockReconcileProjectStartState).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(mockReconcileProjectStartState).toHaveBeenCalledTimes(1);
  });

  it("checks immediately after conat reconnects", async () => {
    render(<TestComponent />);
    await act(async () => Promise.resolve());
    mockReconcileProjectStartState.mockClear();

    await act(async () => {
      webapp_client.conat_client.emit("connected");
      await Promise.resolve();
    });
    expect(mockReconcileProjectStartState).toHaveBeenCalledTimes(1);
  });
});
