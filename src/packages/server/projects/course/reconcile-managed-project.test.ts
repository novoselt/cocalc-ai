export {};

let assertProjectNotRehomingMock: jest.Mock;
let appendProjectOutboxEventForProjectMock: jest.Mock;
let publishProjectDetailInvalidationBestEffortMock: jest.Mock;
let publishProjectAccountFeedEventsBestEffortMock: jest.Mock;
let syncProjectUsersOnHostMock: jest.Mock;
let inviteCollaboratorMock: jest.Mock;
let inviteCollaboratorWithoutAccountMock: jest.Mock;
let queryMock: jest.Mock;

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    query: (...args: any[]) => queryMock(...args),
    connect: async () => ({ query: queryMock, release: jest.fn() }),
  })),
}));

jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => "bay-0",
}));

jest.mock("@cocalc/database/postgres/project-events-outbox", () => ({
  appendProjectOutboxEventForProject: (...args: any[]) =>
    appendProjectOutboxEventForProjectMock(...args),
}));

jest.mock("@cocalc/database/postgres/project-rehome-fence", () => ({
  assertProjectNotRehoming: (...args: any[]) =>
    assertProjectNotRehomingMock(...args),
}));

jest.mock("@cocalc/server/account/project-detail-feed", () => ({
  publishProjectDetailInvalidationBestEffort: (...args: any[]) =>
    publishProjectDetailInvalidationBestEffortMock(...args),
}));

jest.mock("@cocalc/server/account/project-feed", () => ({
  publishProjectAccountFeedEventsBestEffort: (...args: any[]) =>
    publishProjectAccountFeedEventsBestEffortMock(...args),
}));

jest.mock("@cocalc/server/project-host/control", () => ({
  syncProjectUsersOnHost: (...args: any[]) =>
    syncProjectUsersOnHostMock(...args),
}));

jest.mock("@cocalc/server/projects/collaborators", () => ({
  inviteCollaborator: (...args: any[]) => inviteCollaboratorMock(...args),
  inviteCollaboratorWithoutAccount: (...args: any[]) =>
    inviteCollaboratorWithoutAccountMock(...args),
}));

describe("course managed project reconciliation", () => {
  const ACTOR = "11111111-1111-4111-8111-111111111111";
  const MANAGER = "22222222-2222-4222-8222-222222222222";
  const OWNER = "33333333-3333-4333-8333-333333333333";
  const STUDENT = "44444444-4444-4444-8444-444444444444";
  const EXTRA = "55555555-5555-4555-8555-555555555555";
  const COURSE = "66666666-6666-4666-8666-666666666666";
  const PROJECT = "77777777-7777-4777-8777-777777777777";

  function request(overrides: Record<string, unknown> = {}) {
    return {
      account_id: ACTOR,
      course_project_id: COURSE,
      course_path: "/home/user/classes/main.course",
      manager_account_ids: [ACTOR, MANAGER],
      project_id: PROJECT,
      type: "student" as const,
      course: {
        type: "student" as const,
        project_id: COURSE,
        path: "classes/main.course",
        datastore: false,
      },
      title: "Student - Course",
      description: "Course project",
      allow_collabs: false,
      desired_account_ids: [STUDENT],
      student_id: "student-1",
      ...overrides,
    };
  }

  function matchingState(overrides: Record<string, unknown> = {}) {
    return {
      project_id: PROJECT,
      users: {
        [ACTOR]: { group: "collaborator" as const, hide: true },
        [MANAGER]: { group: "collaborator" as const },
        [OWNER]: { group: "owner" as const },
        [STUDENT]: { group: "collaborator" as const },
      },
      course: {
        datastore: false,
        path: "classes/main.course",
        project_id: COURSE,
        type: "student",
      },
      title: "Student - Course",
      description: "Course project",
      env: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    assertProjectNotRehomingMock = jest.fn(async () => undefined);
    appendProjectOutboxEventForProjectMock = jest.fn(async () => undefined);
    publishProjectDetailInvalidationBestEffortMock = jest.fn(
      async () => undefined,
    );
    publishProjectAccountFeedEventsBestEffortMock = jest.fn(
      async () => undefined,
    );
    syncProjectUsersOnHostMock = jest.fn(async () => undefined);
    inviteCollaboratorMock = jest.fn(async () => undefined);
    inviteCollaboratorWithoutAccountMock = jest.fn(async () => ({
      invites: [],
    }));
    queryMock = jest.fn(async (sql: string) => {
      if (sql.includes("SELECT users, course")) {
        return {
          rows: [
            {
              users: {
                [OWNER]: { group: "owner" },
                [ACTOR]: { group: "collaborator", hide: false },
                [EXTRA]: { group: "collaborator" },
              },
              course: null,
              title: "Old",
              description: "Old",
              env: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  it("requires the operation creator to be a canonical course manager", async () => {
    const { reconcileCourseManagedProjectLocal } =
      await import("./reconcile-managed-project");
    await expect(
      reconcileCourseManagedProjectLocal(
        request({ manager_account_ids: [MANAGER] }),
      ),
    ).rejects.toThrow("creator is no longer a course manager");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("refuses to adopt an unlinked project no course manager controls", async () => {
    queryMock = jest.fn(async (sql: string) => {
      if (sql.includes("SELECT users, course")) {
        return {
          rows: [
            {
              users: { [OWNER]: { group: "owner" } },
              course: null,
              title: "Old",
              description: "Old",
              env: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { reconcileCourseManagedProjectLocal } =
      await import("./reconcile-managed-project");
    await expect(reconcileCourseManagedProjectLocal(request())).rejects.toThrow(
      "no current course manager has project access",
    );
    expect(queryMock).toHaveBeenCalledWith("ROLLBACK");
  });

  it("repairs managers, preserves owners, and removes unrelated collaborators", async () => {
    const { reconcileCourseManagedProjectLocal } =
      await import("./reconcile-managed-project");
    await expect(
      reconcileCourseManagedProjectLocal(request()),
    ).resolves.toEqual({ project_id: PROJECT });

    const update = queryMock.mock.calls.find(([sql]) =>
      sql.includes("UPDATE projects"),
    );
    const users = JSON.parse(update[1][1]);
    expect(users).toMatchObject({
      [OWNER]: { group: "owner" },
      [ACTOR]: { group: "collaborator", hide: true },
      [MANAGER]: { group: "collaborator" },
    });
    expect(users[EXTRA]).toBeUndefined();
    expect(inviteCollaboratorMock).toHaveBeenCalledWith({
      account_id: ACTOR,
      opts: { project_id: PROJECT, account_id: STUDENT },
    });
    expect(JSON.parse(update[1][2])).toMatchObject({
      project_id: COURSE,
      path: "classes/main.course",
      type: "student",
    });
  });

  it("does not rewrite a project that already matches", async () => {
    queryMock = jest.fn(async (sql: string) => {
      if (sql.includes("SELECT users, course")) {
        return {
          rows: [
            {
              users: {
                [ACTOR]: { group: "collaborator", hide: true },
                [MANAGER]: { group: "collaborator" },
                [OWNER]: { group: "owner" },
                [STUDENT]: { group: "collaborator" },
              },
              course: {
                datastore: false,
                path: "classes/main.course",
                project_id: COURSE,
                type: "student",
              },
              title: "Student - Course",
              description: "Course project",
              env: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { reconcileCourseManagedProjectLocal } =
      await import("./reconcile-managed-project");
    await reconcileCourseManagedProjectLocal(request({ allow_collabs: true }));
    expect(
      queryMock.mock.calls.some(([sql]) => sql.includes("UPDATE projects")),
    ).toBe(false);
    expect(inviteCollaboratorMock).not.toHaveBeenCalled();
  });

  it("identifies exact matches without entering the mutation path", async () => {
    const { courseManagedProjectNeedsReconcile } =
      await import("./reconcile-managed-project");
    expect(courseManagedProjectNeedsReconcile(request(), matchingState())).toBe(
      false,
    );
    expect(
      courseManagedProjectNeedsReconcile(
        request(),
        matchingState({ title: "Outdated title" }),
      ),
    ).toBe(true);
    expect(
      courseManagedProjectNeedsReconcile(
        request({ send_email_invite: true }),
        matchingState(),
      ),
    ).toBe(true);
  });

  it("loads project state for a bay in one query", async () => {
    const secondProject = "99999999-9999-4999-8999-999999999999";
    queryMock = jest.fn(async (sql: string) => {
      if (sql.includes("project_id=ANY")) {
        return {
          rows: [matchingState(), matchingState({ project_id: secondProject })],
        };
      }
      return { rows: [] };
    });
    const { getCourseManagedProjectStatesLocal } =
      await import("./reconcile-managed-project");
    await expect(
      getCourseManagedProjectStatesLocal({
        project_ids: [PROJECT, secondProject, PROJECT],
      }),
    ).resolves.toHaveLength(2);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual([
      [PROJECT, secondProject],
      "bay-0",
    ]);
    expect(queryMock.mock.calls[0][0]).not.toContain("$2::uuid");
  });

  it("passes canonical course context to email invitations", async () => {
    inviteCollaboratorWithoutAccountMock = jest.fn(async () => ({
      invites: [{ invite_id: "invite" }],
    }));
    const { reconcileCourseManagedProjectLocal } =
      await import("./reconcile-managed-project");
    await expect(
      reconcileCourseManagedProjectLocal(
        request({
          desired_account_ids: [],
          student_email_address: "student@example.com",
          send_email_invite: true,
          invite: {
            subject: "Course invitation",
            message: "Join the course",
            email_html: "<p>Join the course</p>",
          },
        }),
      ),
    ).resolves.toMatchObject({
      project_id: PROJECT,
      email_invited_at: expect.any(String),
    });
    expect(inviteCollaboratorWithoutAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: ACTOR,
        opts: expect.objectContaining({
          invite_scope: "course_student",
          invite_context: expect.objectContaining({
            course_project_id: COURSE,
            course_path: "/home/user/classes/main.course",
          }),
        }),
      }),
    );
  });
});
