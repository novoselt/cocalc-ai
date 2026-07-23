/** @jest-environment jsdom */
/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Reconnect behavior of the side-chat actions acquisition inside
useAnchoredThreads: when the chat syncdb closes, the hook re-acquires
fresh actions; if re-acquisition throws, it keeps retrying (3s timer)
instead of getting permanently stuck.
*/

import { EventEmitter } from "events";
import { act, render, waitFor } from "@testing-library/react";

import { useAnchoredThreads } from "../anchors";

jest.mock("@cocalc/frontend/app-framework", () => ({
  useTypedRedux: () => "acct-1",
}));

jest.mock("../unread", () => ({
  ensureSideChatActions: jest.fn(),
}));

const { ensureSideChatActions } = jest.requireMock("../unread") as {
  ensureSideChatActions: jest.Mock;
};

function makeFakeActions() {
  const store = new EventEmitter();
  const syncdb = new EventEmitter() as EventEmitter & {
    get_state: () => string;
  };
  let state = "ready";
  syncdb.get_state = () => state;
  return {
    store,
    syncdb,
    close: () => {
      state = "closed";
      syncdb.emit("close");
    },
    listThreadConfigRows: () => [],
    getThreadIndex: () => new Map(),
    getThreadReadCount: () => 0,
    isProjectReadStateReady: () => true,
  };
}

function Probe({
  onInfo,
}: {
  onInfo: (info: ReturnType<typeof useAnchoredThreads>) => void;
}) {
  const info = useAnchoredThreads("project-1", "notes.tex", "hash1234");
  onInfo(info);
  return null;
}

describe("useAnchoredThreads reconnect", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    ensureSideChatActions.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("re-acquires after close, retrying through a failed attempt", async () => {
    const first = makeFakeActions();
    const second = makeFakeActions();
    ensureSideChatActions
      .mockReturnValueOnce(first)
      .mockImplementationOnce(() => {
        throw new Error("chat not available yet");
      })
      .mockReturnValue(second);

    let latest: any;
    render(<Probe onInfo={(info) => (latest = info)} />);
    await waitFor(() => expect(latest?.chatActions).toBe(first));

    // Close the first syncdb: the hook bumps its acquire token and the
    // next acquisition attempt throws...
    act(() => {
      first.close();
    });
    await waitFor(() => expect(ensureSideChatActions).toHaveBeenCalledTimes(2));
    expect(latest?.chatActions).toBeUndefined();

    // ...but the retry timer recovers with the fresh actions.
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    await waitFor(() => expect(latest?.chatActions).toBe(second));
  });
});
