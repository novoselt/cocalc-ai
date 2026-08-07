/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Map as ImmutableMap } from "immutable";
import { Actions } from "./actions";

describe("whiteboard initial page creation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createActions() {
    let document = ImmutableMap();
    let versions: string[] = [];
    let liveConnected = true;
    const createPage = jest.fn();
    const actions = Object.create(Actions.prototype) as any;
    actions.initialPageCreationScheduled = false;
    actions._state = undefined;
    actions.isClosed = () => false;
    actions._syncstring = {
      get_state: () => "ready",
      is_read_only: () => false,
      is_live_connected: () => liveConnected,
      get: () => document,
      versions: () => versions,
    };
    actions.store = {
      get: (key: string) => (key === "pages" ? ImmutableMap() : undefined),
    };
    actions.createPage = createPage;
    return {
      actions,
      createPage,
      setDocument: (value) => {
        document = value;
      },
      setLiveConnected: (value: boolean) => {
        liveConnected = value;
      },
      setVersions: (value: string[]) => {
        versions = value;
      },
    };
  }

  it("creates one page when the authoritative document remains empty", () => {
    const { actions, createPage } = createActions();

    actions.scheduleInitialPageCreation();
    actions.scheduleInitialPageCreation();
    jest.runAllTimers();

    expect(createPage).toHaveBeenCalledTimes(1);
  });

  it("does not create a page when content arrives before the callback", () => {
    const { actions, createPage, setDocument } = createActions();

    actions.scheduleInitialPageCreation();
    setDocument(ImmutableMap({ existing: ImmutableMap({ type: "page" }) }));
    jest.runAllTimers();

    expect(createPage).not.toHaveBeenCalled();
  });

  it("does not create starter content for an existing history", () => {
    const { actions, createPage, setVersions } = createActions();

    actions.scheduleInitialPageCreation();
    setVersions(["existing-patch"]);
    jest.runAllTimers();

    expect(createPage).not.toHaveBeenCalled();
  });

  it("does not create starter content while disconnected", () => {
    const { actions, createPage, setLiveConnected } = createActions();

    actions.scheduleInitialPageCreation();
    setLiveConnected(false);
    jest.runAllTimers();

    expect(createPage).not.toHaveBeenCalled();
  });
});
