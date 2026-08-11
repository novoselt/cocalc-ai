/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

let assertCanSaveBlobForAccountMock: jest.Mock;

jest.mock("@cocalc/server/membership/blob-limits", () => ({
  __esModule: true,
  assertCanSaveBlobForAccount: (...args: any[]) =>
    assertCanSaveBlobForAccountMock(...args),
}));

describe("blob byte store integration", () => {
  beforeEach(() => {
    jest.resetModules();
    assertCanSaveBlobForAccountMock = jest.fn(async () => undefined);
  });

  it("saves through the configured byte store after admission checks", async () => {
    const { uuidsha1 } = await import("@cocalc/backend/misc_node");
    const { saveBlobToDatabase } = await import("./save");
    const { setBlobByteStoreForTesting } = await import("./store");
    const blob = Buffer.from("hello blob");
    const uuid = uuidsha1(blob);
    const put = jest.fn(async () => undefined);

    setBlobByteStoreForTesting({
      get: jest.fn(),
      put,
    });

    await saveBlobToDatabase({
      uuid,
      blob,
      ttl: "60",
      project_id: "project-1",
      account_id: "account-1",
    });

    expect(assertCanSaveBlobForAccountMock).toHaveBeenCalledWith({
      account_id: "account-1",
      project_id: "project-1",
      uuid,
      blobSize: blob.length,
    });
    expect(put).toHaveBeenCalledWith({
      uuid,
      blob,
      ttl: 60,
      project_id: "project-1",
      account_id: "account-1",
    });
  });

  it("reads through the configured byte store", async () => {
    const { uuidsha1 } = await import("@cocalc/backend/misc_node");
    const { readBlobFromDatabase } = await import("./read");
    const { setBlobByteStoreForTesting } = await import("./store");
    const blob = Buffer.from("stored blob");
    const uuid = uuidsha1(blob);
    const get = jest.fn(async () => blob);

    setBlobByteStoreForTesting({
      get,
      put: jest.fn(),
    });

    await expect(readBlobFromDatabase(uuid)).resolves.toEqual(blob);
    expect(get).toHaveBeenCalledWith(uuid);
  });

  it("rejects invalid read uuids before hitting storage", async () => {
    const { readBlobFromDatabase } = await import("./read");
    const { setBlobByteStoreForTesting } = await import("./store");
    const get = jest.fn();

    setBlobByteStoreForTesting({
      get,
      put: jest.fn(),
    });

    await expect(readBlobFromDatabase("not-a-uuid")).rejects.toThrow(
      "blob uuid is invalid",
    );
    expect(get).not.toHaveBeenCalled();
  });
});
