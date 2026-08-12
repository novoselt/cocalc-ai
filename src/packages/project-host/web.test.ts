jest.mock("./exam/controller", () => ({
  getExamBrowserBootstrap: jest.fn(),
  getExamBrowserSession: jest.fn(),
  getExamRunStatusLocal: jest.fn(() => ({
    admission_open: false,
    active_projects: 0,
  })),
  joinExamRun: jest.fn(),
}));

import {
  getExamJoinPage,
  getProjectHostCustomizePayload,
  isExamPostOriginAllowed,
} from "./web";

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
    const exam_session = {
      delete_at: "2026-08-01T04:00:00.000Z",
      account: { account_id: "00000000-1000-4000-8000-000000000001" },
      project: { project_id: "00000000-1000-4000-8000-000000000002" },
    } as any;
    const payload = getProjectHostCustomizePayload({
      account_id: "00000000-1000-4000-8000-000000000001",
      project_id: "00000000-1000-4000-8000-000000000002",
      exam_mode: true,
      terminal_enabled: false,
      exam_session,
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
      scratchpad_delete_at: "2026-08-01T04:00:00.000Z",
    });
    expect(payload.exam_session).toBe(exam_session);
  });
});

describe("project-host exam admission page", () => {
  it("accepts the public HTTPS origin behind an HTTP reverse proxy", () => {
    expect(
      isExamPostOriginAllowed({
        origin: "https://exam-host.example.test",
        host: "exam-host.example.test",
      }),
    ).toBe(true);
  });

  it("rejects cross-host and malformed admission origins", () => {
    expect(
      isExamPostOriginAllowed({
        origin: "https://attacker.example.test",
        host: "exam-host.example.test",
      }),
    ).toBe(false);
    expect(
      isExamPostOriginAllowed({
        origin: "not a URL",
        host: "exam-host.example.test",
      }),
    ).toBe(false);
  });

  it("only asks for the token while admission is open", () => {
    const open = getExamJoinPage({
      admission_open: true,
      title: "Linear Algebra Scratchpad",
      scheduled_stop_at: "2026-08-01T04:00:00.000Z",
    });
    expect(open).toContain('<meta name="referrer" content="same-origin">');
    expect(open).toContain('<script src="/exam/admission.js" defer></script>');
    expect(open).toContain("Temporary private computational project");
    expect(open).toContain("Linear Algebra Scratchpad");
    expect(open).toContain("Enter the token provided to you");
    expect(open).toContain("completely erased automatically");
    expect(open).toContain('datetime="2026-08-01T04:00:00.000Z"');
    expect(open).toContain("with nothing retained");
    expect(open).toContain("Access token");
    expect(open).toContain('name="token"');
    expect(open).not.toContain("admission is not open yet");
  });

  it("tells students to wait without asking for a token while closed", () => {
    const closed = getExamJoinPage({ admission_open: false });
    expect(closed).toContain("access is not open yet");
    expect(closed).toContain("Wait for access to open");
    expect(closed).not.toContain("Enter the token provided to you");
    expect(closed).not.toContain('name="token"');
  });

  it("explains instructor-controlled cleanup for practice sessions", () => {
    const page = getExamJoinPage({
      admission_open: true,
      cleanup_mode: "manual",
    });
    expect(page).toContain("until your instructor ends the session");
    expect(page).not.toContain("erased automatically");
  });
});
