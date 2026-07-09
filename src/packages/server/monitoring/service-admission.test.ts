/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export {};

const queryMock = jest.fn();
const adminAlertMock = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    query: (...args: any[]) => queryMock(...args),
  })),
}));

jest.mock("@cocalc/server/messages/admin-alert", () => ({
  __esModule: true,
  default: (...args: any[]) => adminAlertMock(...args),
}));

describe("service admission monitoring", () => {
  beforeEach(() => {
    jest.resetModules();
    queryMock.mockReset();
    adminAlertMock.mockReset();
  });

  it("includes burst span context in admission alerts", async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          surface: "conat-typed-service",
          denial_limit: "COCALC_CONAT_SERVICE_MAX_PARALLEL_ACTIVE",
          source: "fast-rpc-handler",
          key: "inter-bay-directory",
          account_id: null,
          project_id: null,
          sample_subject: "inter-bay.directory",
          sample_reason: "typed service is busy",
          count: 719,
          first_time: "2026-06-29T21:04:10.861Z",
          last_time: "2026-06-29T21:04:10.990Z",
          max_current: 128,
          max_maximum: 128,
        },
        {
          surface: "hub-conat-api",
          denial_limit: "COCALC_HUB_CONAT_API_MAX_ACTIVE",
          source: "hub-api",
          key: "hosts.resolveHostConnection",
          account_id: "account-1",
          project_id: null,
          sample_subject: "hub.host.api",
          sample_reason: "hub api server is busy",
          count: 350,
          first_time: "2026-06-29T21:04:10.928Z",
          last_time: "2026-06-29T21:04:10.965Z",
          max_current: 1000,
          max_maximum: 1000,
        },
      ],
    });

    const { runServiceAdmissionAlertCheck } =
      await import("./service-admission");

    await expect(runServiceAdmissionAlertCheck()).resolves.toBe(1069);
    expect(adminAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(
          "Observed denial span across top groups: 129ms",
        ),
      }),
    );
    expect(adminAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(
          "A short span usually indicates a burst or retry fan-out",
        ),
      }),
    );
    expect(adminAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("span=129ms"),
      }),
    );
    expect(adminAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("account=account-1"),
      }),
    );
    expect(adminAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("subject=hub.host.api"),
      }),
    );
  });
});
