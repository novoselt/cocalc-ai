/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { EventEmitter } from "events";

const mockSyncTableFactory = jest.fn();

jest.mock("../webapp-client", () => ({
  webapp_client: {
    sync_client: {
      sync_table: (...args: any[]) => mockSyncTableFactory(...args),
      synctable_no_changefeed: (...args: any[]) =>
        mockSyncTableFactory(...args),
    },
  },
}));

import { Table } from "./Table";

class MockSyncTable extends EventEmitter {
  ready: boolean;
  set = jest.fn();
  save = jest.fn(async () => {});
  close = jest.fn();

  constructor(ready: boolean) {
    super();
    this.ready = ready;
  }

  is_ready = () => this.ready;

  connect = () => {
    this.ready = true;
    this.emit("connected");
  };

  closeBeforeConnect = () => {
    this.emit("closed");
  };
}

class TestTable extends Table {
  query() {
    return { test: [{ id: null }] };
  }

  protected _change() {}
}

function createTable(syncTable: MockSyncTable) {
  mockSyncTableFactory.mockReturnValueOnce(syncTable);
  return new TestTable("test", {} as any);
}

describe("Table.set initialization lifecycle", () => {
  beforeEach(() => {
    mockSyncTableFactory.mockReset();
  });

  it("updates an initialized table immediately", async () => {
    const syncTable = new MockSyncTable(true);
    const table = createTable(syncTable);
    const writing = table.set({ id: "ready" });

    expect(syncTable.set).toHaveBeenCalledWith({ id: "ready" }, undefined);
    await writing;
    expect(syncTable.save).toHaveBeenCalledTimes(1);
  });

  it("waits for initial table data before updating", async () => {
    const syncTable = new MockSyncTable(false);
    const table = createTable(syncTable);
    const writing = table.set({ id: "waiting" });

    expect(syncTable.set).not.toHaveBeenCalled();
    syncTable.connect();
    await writing;

    expect(syncTable.set).toHaveBeenCalledWith({ id: "waiting" }, undefined);
    expect(syncTable.save).toHaveBeenCalledTimes(1);
  });

  it("abandons a pending write when the table closes during teardown", async () => {
    const syncTable = new MockSyncTable(false);
    const table = createTable(syncTable);
    const writing = table.set({ id: "closed" });

    syncTable.closeBeforeConnect();

    await expect(writing).resolves.toBeUndefined();
    expect(syncTable.set).not.toHaveBeenCalled();
    expect(syncTable.save).not.toHaveBeenCalled();
  });
});
