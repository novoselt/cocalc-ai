jest.mock("./exam/controller", () => ({
  getExamBrowserSession: jest.fn(),
  getExamRunStatusLocal: jest.fn(() => ({
    admission_open: false,
    active_projects: 0,
  })),
  joinExamRun: jest.fn(),
}));

import { getExamJoinPage, getProjectHostCustomizePayload } from "./web";

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

describe("project-host exam admission page", () => {
  it("only asks for the token while admission is open", () => {
    const open = getExamJoinPage({ admission_open: true });
    expect(open).toContain("Enter the token provided by your instructor");
    expect(open).toContain('name="token"');
    expect(open).not.toContain("admission is not open yet");
  });

  it("tells students to wait without asking for a token while closed", () => {
    const closed = getExamJoinPage({ admission_open: false });
    expect(closed).toContain("admission is not open yet");
    expect(closed).toContain("Wait for your instructor to open admission");
    expect(closed).not.toContain("Enter the token provided by your instructor");
    expect(closed).not.toContain('name="token"');
  });
});
