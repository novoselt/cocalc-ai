/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { once } from "@cocalc/util/async-utils";
import { SyncString } from "../sync";
import { Client, fs } from "./client-test";
import { a_txt } from "./data";
import { Session as PatchflowSession } from "patchflow";

class AlertingClient extends Client {
  public alerts: any[] = [];

  public override alert_message(opts): void {
    this.alerts.push(opts);
  }
}

describe("patchflow commit failures", () => {
  const { client_id, project_id, path, init_queries } = a_txt();
  let client: AlertingClient;
  let syncstring: SyncString;

  afterEach(async () => {
    jest.restoreAllMocks();
    if (syncstring != null && syncstring.get_state() !== "closed") {
      await syncstring.close();
    }
  });

  it("surfaces a user-visible error and dedupes repeated failures", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    client = new AlertingClient(init_queries, client_id);
    syncstring = new SyncString({
      project_id,
      path,
      client,
      fs,
      noAutosave: true,
    });
    await once(syncstring, "ready");

    const patchflowStore = (syncstring as any).patchflowStore;
    patchflowStore.append = () => {
      throw new Error("db write failed");
    };

    syncstring.from_str("a");
    expect(syncstring.commit()).toBe(false);
    syncstring.from_str("ab");
    expect(syncstring.commit()).toBe(false);

    expect(client.alerts).toHaveLength(1);
    expect(client.alerts[0]).toMatchObject({
      title: "Unable to save changes",
      type: "error",
    });
    expect(client.alerts[0].message).toContain(path);
    expect(client.alerts[0].message).toContain("db write failed");
  });

  it("never writes an uncommitted draft to disk", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    client = new AlertingClient(init_queries, client_id);
    const writeFileDelta = jest.fn(async () => {});
    syncstring = new SyncString({
      project_id,
      path,
      client,
      fs: { ...fs, writeFileDelta },
      noAutosave: true,
    });
    await once(syncstring, "ready");

    const patchflowStore = (syncstring as any).patchflowStore;
    patchflowStore.append = () => {
      throw new Error("db write failed");
    };
    syncstring.from_str("must remain a draft");

    await expect(syncstring.save_to_disk()).rejects.toThrow(
      "collaborative history is not up to date",
    );
    expect(writeFileDelta).not.toHaveBeenCalled();
    expect(syncstring.to_str()).toBe("must remain a draft");
  });

  it("persists a draft to Patchflow before writing it to disk", async () => {
    client = new AlertingClient(init_queries, client_id);
    const writeFileDelta = jest.fn(async () => {});
    syncstring = new SyncString({
      project_id,
      path,
      client,
      fs: { ...fs, writeFileDelta },
      noAutosave: true,
    });
    await once(syncstring, "ready");
    syncstring.from_str("safely committed");

    await syncstring.save_to_disk();

    expect(writeFileDelta).toHaveBeenCalledWith(
      path,
      "safely committed",
      expect.objectContaining({ saveLast: true }),
    );
    expect(syncstring.has_uncommitted_changes()).toBe(false);
  });

  it("retries cleanly after a transient patchflow init failure", async () => {
    jest.setTimeout(10_000);
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "trace").mockImplementation(() => {});
    const originalInit = PatchflowSession.prototype.init;
    let calls = 0;
    jest.spyOn(PatchflowSession.prototype, "init").mockImplementation(function (
      this: PatchflowSession,
    ) {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error("transient patchflow init failure"));
      }
      return originalInit.call(this);
    });

    client = new AlertingClient(init_queries, client_id);
    syncstring = new SyncString({
      project_id,
      path,
      client,
      fs,
      noAutosave: true,
    });

    await once(syncstring, "ready");
    expect(calls).toBeGreaterThan(1);
    expect(syncstring.to_str()).toBe("");
  });

  it("ignores a commit while the patchflow session is initializing", async () => {
    jest.setTimeout(10_000);
    const originalInit = PatchflowSession.prototype.init;
    let releaseInit!: () => void;
    let initStarted!: () => void;
    const initGate = new Promise<void>((resolve) => {
      releaseInit = resolve;
    });
    const started = new Promise<void>((resolve) => {
      initStarted = resolve;
    });
    jest
      .spyOn(PatchflowSession.prototype, "init")
      .mockImplementation(async function (this: PatchflowSession) {
        initStarted();
        await initGate;
        return await originalInit.call(this);
      });

    client = new AlertingClient(init_queries, client_id);
    syncstring = new SyncString({
      project_id,
      path,
      client,
      fs,
      noAutosave: true,
    });
    const ready = once(syncstring, "ready");
    await started;

    expect(syncstring.commit()).toBe(false);

    releaseInit();
    await ready;
  });

  it("continues committing locally while the live connection is offline", async () => {
    client = new AlertingClient(init_queries, client_id);
    syncstring = new SyncString({
      project_id,
      path,
      client,
      fs,
      noAutosave: true,
    });
    await once(syncstring, "ready");
    (syncstring as any).liveConnected = false;

    syncstring.from_str("offline edit");

    expect(syncstring.commit()).toBe(true);
    expect(syncstring.to_str()).toBe("offline edit");
  });
});
