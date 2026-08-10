import type { ProjectCollabInviteRow } from "@cocalc/conat/hub/api/projects";
import { validate_client_query } from "@cocalc/util/schema-validate";
import {
  classifyFirstRunOnboarding,
  isCourseInvitation,
  signUpUsageIntentQuery,
} from "./state";

const invite = {
  invite_id: "invite-1",
  project_id: "project-1",
  inviter_account_id: "account-1",
  status: "pending",
  created: new Date(),
  updated: new Date(),
} as ProjectCollabInviteRow;

describe("classifyFirstRunOnboarding", () => {
  it("waits for invitations before showing the empty-state chooser", () => {
    expect(
      classifyFirstRunOnboarding({
        projects: [],
        invitations: [],
        invitesLoading: true,
      }),
    ).toEqual({ kind: "loading" });
  });

  it("prioritizes an invitation for a new account", () => {
    expect(
      classifyFirstRunOnboarding({
        projects: [],
        invitations: [invite],
        invitesLoading: false,
        accountCreated: new Date(),
      }),
    ).toEqual({ kind: "invitations", invitations: [invite] });
  });

  it("shows the intent chooser whenever the ordinary result is blank", () => {
    expect(
      classifyFirstRunOnboarding({
        projects: [],
        invitations: [],
        invitesLoading: false,
        accountCreated: "2020-01-01",
      }),
    ).toEqual({ kind: "intent" });
  });

  it("does not interrupt an established account with projects", () => {
    expect(
      classifyFirstRunOnboarding({
        projects: [
          { project_id: "project-1", last_active: new Date().toISOString() },
        ],
        invitations: [invite],
        invitesLoading: false,
        accountCreated: new Date(),
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("offers onboarding again after its only completed project is deleted", () => {
    expect(
      classifyFirstRunOnboarding({
        projects: [],
        invitations: [],
        invitesLoading: false,
        saved: {
          version: 1,
          status: "completed",
          intent: "codex",
          project_id: "deleted-project",
          updated_at: new Date().toISOString(),
        },
      }),
    ).toEqual({ kind: "intent" });
  });

  it("keeps non-project onboarding completion durable", () => {
    expect(
      classifyFirstRunOnboarding({
        projects: [],
        invitations: [],
        invitesLoading: false,
        saved: {
          version: 1,
          status: "completed",
          intent: "license-site",
          updated_at: new Date().toISOString(),
        },
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("resumes a project whose first-run setup was interrupted", () => {
    const project = { project_id: "project-1" };
    expect(
      classifyFirstRunOnboarding({
        projects: [project],
        invitations: [],
        invitesLoading: false,
        saved: {
          version: 1,
          status: "in_progress",
          intent: "jupyter-python",
          project_id: project.project_id,
          updated_at: new Date().toISOString(),
        },
      }),
    ).toEqual({ kind: "ready-projects", projects: [project] });
  });

  it("does not flash while invitations load for an established account", () => {
    expect(
      classifyFirstRunOnboarding({
        projects: [
          { project_id: "project-1", last_active: new Date().toISOString() },
        ],
        invitations: [],
        invitesLoading: true,
        accountCreated: "2020-01-01",
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("recognizes course invite metadata", () => {
    expect(isCourseInvitation({ ...invite, scope: "course_student" })).toBe(
      true,
    );
    expect(isCourseInvitation(invite)).toBe(false);
  });
});

describe("signUpUsageIntentQuery", () => {
  it("uses the write-only accounts query supported by the user schema", () => {
    const query = signUpUsageIntentQuery("jupyter-python");
    expect(query).toEqual({
      accounts: { sign_up_usage_intent: "jupyter-python" },
    });
    expect(
      validate_client_query(query, "00000000-0000-4000-8000-000000000000"),
    ).toBeUndefined();
  });
});
