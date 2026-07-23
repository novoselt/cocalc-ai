/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { EventEmitter } from "events";
import { fromJS } from "immutable";

import { JupyterActions } from "./actions";

class MockSyncTable extends EventEmitter {
  ready: boolean;

  constructor(ready = false) {
    super();
    this.ready = ready;
  }

  is_ready = () => this.ready;

  connect = () => {
    this.ready = true;
    this.emit("connected");
  };
}

function createActions() {
  let accountTable: any;
  const accountStore = {
    getIn: jest.fn(() =>
      fromJS({
        theme: "classic",
      }),
    ),
  };
  const redux = {
    getStore: jest.fn(() => accountStore),
    getTable: jest.fn(() => accountTable),
  };
  const actions = new JupyterActions(
    "default-kernel-test",
    redux as any,
  ) as any;
  actions.is_project = false;
  actions._state = "ready";
  actions._client = { dbg: () => jest.fn() };
  actions.path = "test.ipynb";
  return {
    actions,
    accountStore,
    setAccountTable: (value: any) => {
      accountTable = value;
    },
  };
}

function createAccountTable(syncTable = new MockSyncTable(true)) {
  return {
    _table: syncTable,
    set: jest.fn(async () => {}),
  };
}

describe("Jupyter default kernel persistence", () => {
  it("writes immediately after the account table is initialized", async () => {
    const { actions, setAccountTable } = createActions();
    const accountTable = createAccountTable();
    setAccountTable(accountTable);

    await actions.set_default_kernel("python3");

    expect(accountTable.set).toHaveBeenCalledWith({
      editor_settings: {
        jupyter: {
          kernel: "python3",
          theme: "classic",
        },
      },
    });
  });

  it("waits for the account table's initial value before writing", async () => {
    const { actions, setAccountTable } = createActions();
    const syncTable = new MockSyncTable();
    const accountTable = createAccountTable(syncTable);
    setAccountTable(accountTable);

    const writing = actions.set_default_kernel("python3");
    expect(accountTable.set).not.toHaveBeenCalled();
    syncTable.connect();
    await writing;

    expect(accountTable.set).toHaveBeenCalledTimes(1);
  });

  it("uses a replacement account table when the old one closes", async () => {
    const { actions, setAccountTable } = createActions();
    const oldSyncTable = new MockSyncTable();
    const oldAccountTable = createAccountTable(oldSyncTable);
    const replacementAccountTable = createAccountTable();
    setAccountTable(oldAccountTable);

    const writing = actions.set_default_kernel("python3");
    setAccountTable(replacementAccountTable);
    oldSyncTable.emit("closed");
    await writing;

    expect(oldAccountTable.set).not.toHaveBeenCalled();
    expect(replacementAccountTable.set).toHaveBeenCalledTimes(1);
  });

  it("contains a preference write failure", async () => {
    const { actions, setAccountTable } = createActions();
    const accountTable = createAccountTable();
    accountTable.set.mockRejectedValue(new Error("write failed"));
    setAccountTable(accountTable);

    await expect(
      actions.set_default_kernel("python3"),
    ).resolves.toBeUndefined();
  });
});
