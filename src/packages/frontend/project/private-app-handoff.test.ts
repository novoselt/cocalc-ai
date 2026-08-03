/** @jest-environment jsdom */

const getPrivateProjectAppOpenUrl = jest.fn();

jest.mock("./app-server-open", () => ({
  getPrivateProjectAppOpenUrl: (...args: unknown[]) =>
    getPrivateProjectAppOpenUrl(...args),
}));

import { handoffToPrivateProjectApp } from "./private-app-handoff";

describe("handoffToPrivateProjectApp", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves an authenticated URL before navigating", async () => {
    const navigate = jest.fn();
    getPrivateProjectAppOpenUrl.mockResolvedValue(
      "https://dev-example.cocalc.ai/?auth=token",
    );

    await handoffToPrivateProjectApp({
      appId: "cocalc-dev-main",
      navigate,
      projectId: "project-1",
    });

    expect(getPrivateProjectAppOpenUrl).toHaveBeenCalledWith({
      app_id: "cocalc-dev-main",
      project_id: "project-1",
    });
    expect(navigate).toHaveBeenCalledWith(
      "https://dev-example.cocalc.ai/?auth=token",
    );
  });

  it("does not navigate when URL resolution fails", async () => {
    const navigate = jest.fn();
    getPrivateProjectAppOpenUrl.mockRejectedValue(new Error("not reserved"));

    await expect(
      handoffToPrivateProjectApp({
        appId: "cocalc-dev-main",
        navigate,
        projectId: "project-1",
      }),
    ).rejects.toThrow("not reserved");
    expect(navigate).not.toHaveBeenCalled();
  });
});
