/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

const mockGetStore = jest.fn();
const mockInitMentions = jest.fn();
const mockInitNews = jest.fn();

jest.mock("@cocalc/frontend/app-framework", () => ({
  redux: { getStore: mockGetStore },
}));
jest.mock("./init", () => ({ init: mockInitMentions }));
jest.mock("./news/init", () => ({ init: mockInitNews }));

describe("notification capability initialization", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetStore.mockReset().mockReturnValue(undefined);
    mockInitMentions.mockReset();
    mockInitNews.mockReset();
  });

  it("deduplicates concurrent initialization", async () => {
    const { ensureNotificationsInitialized } = await import("./ensure-init");

    await Promise.all([
      ensureNotificationsInitialized(),
      ensureNotificationsInitialized(),
    ]);

    expect(mockInitMentions).toHaveBeenCalledTimes(1);
    expect(mockInitNews).toHaveBeenCalledTimes(1);
  });

  it("allows retry after an initialization failure", async () => {
    mockInitMentions.mockImplementationOnce(() => {
      throw Error("initialization failed");
    });
    const { ensureNotificationsInitialized } = await import("./ensure-init");

    await expect(ensureNotificationsInitialized()).rejects.toThrow(
      "initialization failed",
    );
    await ensureNotificationsInitialized();

    expect(mockInitMentions).toHaveBeenCalledTimes(2);
    expect(mockInitNews).toHaveBeenCalledTimes(1);
  });

  it("does nothing when both stores already exist", async () => {
    mockGetStore.mockReturnValue({});
    const { ensureNotificationsInitialized } = await import("./ensure-init");

    await ensureNotificationsInitialized();

    expect(mockInitMentions).not.toHaveBeenCalled();
    expect(mockInitNews).not.toHaveBeenCalled();
  });
});
