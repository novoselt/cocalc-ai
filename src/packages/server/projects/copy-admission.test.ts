/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export {};

let authorizeBatchMock: jest.Mock;
let assertStorageMock: jest.Mock;

jest.mock("@cocalc/backend/logger", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
  getLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock("@cocalc/server/conat/project-remote-access", () => ({
  assertProjectCollaboratorAccessAllowRemoteBatch: (...args: any[]) =>
    authorizeBatchMock(...args),
}));

jest.mock("@cocalc/server/membership/project-limits", () => ({
  assertCanIncreaseAccountStorage: (...args: any[]) =>
    assertStorageMock(...args),
}));

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const USAGE_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";

describe("copy destination admission", () => {
  beforeEach(() => {
    jest.resetModules();
    assertStorageMock = jest.fn(async () => undefined);
  });

  it("batches authorization and deduplicates storage attribution", async () => {
    authorizeBatchMock = jest.fn(async () => [
      {
        project_id: "44444444-4444-4444-8444-444444444444",
        usage_account_id: USAGE_ACCOUNT_ID,
        users: { [OWNER_ACCOUNT_ID]: { group: "owner" } },
      },
      {
        project_id: "55555555-5555-4555-8555-555555555555",
        usage_account_id: USAGE_ACCOUNT_ID,
        users: { [OWNER_ACCOUNT_ID]: { group: "owner" } },
      },
      {
        project_id: "66666666-6666-4666-8666-666666666666",
        usage_account_id: null,
        users: { [OWNER_ACCOUNT_ID]: { group: "owner" } },
      },
    ]);
    const { admitCopyDestinations } = await import("./copy-admission");

    await admitCopyDestinations({
      account_id: ACCOUNT_ID,
      dests: [
        {
          project_id: "44444444-4444-4444-8444-444444444444",
          path: "Assignment",
        },
        {
          project_id: "55555555-5555-4555-8555-555555555555",
          path: "Assignment",
        },
        {
          project_id: "66666666-6666-4666-8666-666666666666",
          path: "Assignment",
        },
      ],
    });

    expect(authorizeBatchMock).toHaveBeenCalledWith({
      account_id: ACCOUNT_ID,
      project_ids: [
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
      ],
      warmRoute: false,
    });
    expect(assertStorageMock).toHaveBeenCalledTimes(2);
    expect(assertStorageMock).toHaveBeenCalledWith({
      account_id: USAGE_ACCOUNT_ID,
    });
    expect(assertStorageMock).toHaveBeenCalledWith({
      account_id: OWNER_ACCOUNT_ID,
    });
  });
});
