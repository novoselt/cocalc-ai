jest.mock("./exam/controller", () => ({
  getExamBrowserSession: jest.fn(),
  getExamRunStatusLocal: jest.fn(() => ({
    admission_open: false,
    active_projects: 0,
  })),
  joinExamRun: jest.fn(),
}));

import { getProjectHostCustomizePayload } from "./web";

describe("project-host customize payload", () => {
  it("does not expose account scoped data", () => {
    const payload = getProjectHostCustomizePayload();
    expect(payload.configuration).toEqual({
      lite: false,
      project_host: true,
      site_name: "CoCalc Project Host",
    });
    expect((payload.configuration as any).account_id).toBeUndefined();
    expect(payload.registration).toBe(false);
    expect(payload.strategies).toEqual([]);
  });

  it("restricts the full frontend for an admitted exam session", () => {
    const payload = getProjectHostCustomizePayload({
      account_id: "00000000-1000-4000-8000-000000000001",
      project_id: "00000000-1000-4000-8000-000000000002",
      exam_mode: true,
      terminal_enabled: false,
    });
    expect(payload.configuration).toMatchObject({
      exam_mode: true,
      terminal_enabled: false,
      stripe_enabled: false,
      zendesk: false,
      share_server: false,
      openai_enabled: false,
      agent_openai_codex_enabled: false,
      account_id: "00000000-1000-4000-8000-000000000001",
      project_id: "00000000-1000-4000-8000-000000000002",
    });
  });
});
