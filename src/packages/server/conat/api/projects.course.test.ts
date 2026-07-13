export {};

let getLocalProjectCollaboratorAccessStatusMock: jest.Mock;
let isAdminMock: jest.Mock;
let getPoolMock: jest.Mock;
let queryMock: jest.Mock;
let resolveCourseReferenceMock: jest.Mock;
let resolveAccountHomeBayMock: jest.Mock;
let resolveMembershipForAccountMock: jest.Mock;
let getSeedMembershipTierByIdMock: jest.Mock;
let listMembershipPackagesMock: jest.Mock;
let interBayGetMembershipMock: jest.Mock;
let interBayGetMembershipPackagesMock: jest.Mock;
let claimMembershipPackageSeatWithVerifiedEmailsOnLocalBayMock: jest.Mock;

jest.mock("@cocalc/server/conat/project-local-access", () => ({
  __esModule: true,
  PROJECT_COLLABORATOR_REQUIRED_ERROR: "user must be a collaborator on project",
  PROJECT_NOT_FOUND_ERROR: "project not found",
  getLocalProjectCollaboratorAccessStatus: (...args: any[]) =>
    getLocalProjectCollaboratorAccessStatusMock(...args),
}));

jest.mock("@cocalc/server/accounts/is-admin", () => ({
  __esModule: true,
  default: (...args: any[]) => isAdminMock(...args),
}));

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: (...args: any[]) => getPoolMock(...args),
}));

jest.mock("@cocalc/server/conat/project-remote-access", () => ({
  __esModule: true,
  resolveProjectAccessAllowRemote: jest.fn(),
  resolveProjectReferenceCollaboratorOrAdminAllowRemote: (...args: any[]) =>
    resolveCourseReferenceMock(...args),
}));

jest.mock("@cocalc/server/bay-directory", () => ({
  __esModule: true,
  resolveAccountHomeBay: (...args: any[]) => resolveAccountHomeBayMock(...args),
  resolveProjectOwningBay: jest.fn(),
}));

jest.mock("@cocalc/server/bay-config", () => ({
  __esModule: true,
  getConfiguredBayId: () => "bay-a",
}));

jest.mock("@cocalc/server/inter-bay/fabric", () => ({
  __esModule: true,
  getInterBayFabricClient: jest.fn(() => ({})),
}));

jest.mock("@cocalc/conat/inter-bay/api", () => ({
  __esModule: true,
  createInterBayAccountLocalClient: jest.fn(() => ({
    getMembership: (...args: any[]) => interBayGetMembershipMock(...args),
    getMembershipPackages: (...args: any[]) =>
      interBayGetMembershipPackagesMock(...args),
  })),
}));

jest.mock("@cocalc/server/membership/resolve", () => ({
  __esModule: true,
  resolveMembershipForAccount: (...args: any[]) =>
    resolveMembershipForAccountMock(...args),
}));

jest.mock("@cocalc/server/membership/tiers", () => ({
  __esModule: true,
  getSeedMembershipTierById: (...args: any[]) =>
    getSeedMembershipTierByIdMock(...args),
}));

jest.mock("@cocalc/server/membership/packages", () => ({
  __esModule: true,
  assignMembershipPackageSeat: jest.fn(),
  claimMembershipPackageSeatWithVerifiedEmailsOnLocalBay: (...args: any[]) =>
    claimMembershipPackageSeatWithVerifiedEmailsOnLocalBayMock(...args),
  listClaimableMembershipPackagesForAccount: jest.fn(async () => []),
  listMembershipPackageDetailsForOwner: (...args: any[]) =>
    listMembershipPackagesMock(...args),
}));

describe("project course info helpers", () => {
  const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
  const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    jest.resetModules();
    getLocalProjectCollaboratorAccessStatusMock = jest.fn(
      async () => "local-collaborator",
    );
    isAdminMock = jest.fn(async () => false);
    queryMock = jest.fn(async () => ({
      rows: [
        {
          region: null,
          created: null,
          env: null,
          rootfs_image: null,
          rootfs_image_id: null,
          snapshots: null,
          backups: null,
          run_quota: null,
          settings: null,
          course: {
            type: "student",
            project_id: "33333333-3333-4333-8333-333333333333",
            path: ".course/main.course",
          },
        },
      ],
    }));
    getPoolMock = jest.fn(() => ({ query: queryMock }));
    resolveCourseReferenceMock = jest.fn(async () => ({
      project_id: PROJECT_ID,
      title: "Course",
      host_id: null,
      owning_bay_id: "bay-a",
      users: { [ACCOUNT_ID]: { group: "owner" } },
    }));
    resolveAccountHomeBayMock = jest.fn(async ({ account_id }) => ({
      account_id,
      home_bay_id: "bay-a",
    }));
    resolveMembershipForAccountMock = jest.fn(async () => ({
      class: "free",
      source: "free",
      entitlements: {},
    }));
    getSeedMembershipTierByIdMock = jest.fn(async ({ id }) =>
      id === "student"
        ? { id, label: "Student", priority: 10 }
        : { id, label: "Free", priority: 0 },
    );
    listMembershipPackagesMock = jest.fn(async () => []);
    interBayGetMembershipMock = jest.fn(async () => ({
      class: "free",
      source: "free",
      entitlements: {},
    }));
    interBayGetMembershipPackagesMock = jest.fn(async () => []);
    claimMembershipPackageSeatWithVerifiedEmailsOnLocalBayMock = jest.fn(
      async ({ package_id, account_id }) => ({
        id: "reserved-assignment",
        package_id,
        account_id,
        metadata: {
          course_project_id: "33333333-3333-4333-8333-333333333333",
          project_id: "44444444-4444-4444-8444-444444444444",
          student_id: "77777777-7777-4777-8777-777777777777",
        },
      }),
    );
  });

  it("aggregates linked packages and resolves student membership on its home bay", async () => {
    const COURSE_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
    const STUDENT_PROJECT_ID = "44444444-4444-4444-8444-444444444444";
    const STUDENT_ACCOUNT_ID = "55555555-5555-4555-8555-555555555555";
    const SECOND_MANAGER_ID = "66666666-6666-4666-8666-666666666666";
    const STUDENT_ID = "77777777-7777-4777-8777-777777777777";
    resolveCourseReferenceMock.mockResolvedValue({
      project_id: COURSE_PROJECT_ID,
      title: "Linear Algebra",
      host_id: null,
      owning_bay_id: "bay-a",
      users: {
        [ACCOUNT_ID]: { group: "owner" },
        [SECOND_MANAGER_ID]: { group: "collaborator" },
        [STUDENT_ACCOUNT_ID]: { group: "viewer" },
      },
    });
    queryMock.mockResolvedValue({
      rows: [
        {
          region: null,
          created: null,
          env: null,
          rootfs_image: null,
          rootfs_image_id: null,
          rootfs_publish_config: null,
          snapshots: null,
          backups: null,
          run_quota: null,
          course: {
            type: "student",
            project_id: COURSE_PROJECT_ID,
            account_id: STUDENT_ACCOUNT_ID,
            student_pay: true,
            required_membership_class: "student",
          },
        },
      ],
    });
    resolveAccountHomeBayMock.mockImplementation(async ({ account_id }) => ({
      account_id,
      home_bay_id:
        account_id === STUDENT_ACCOUNT_ID || account_id === SECOND_MANAGER_ID
          ? "bay-b"
          : "bay-a",
    }));
    listMembershipPackagesMock.mockResolvedValue([
      {
        id: "local-package",
        owner_account_id: ACCOUNT_ID,
        kind: "course",
        membership_class: "student",
        seat_count: 30,
        metadata: { course_project_id: COURSE_PROJECT_ID },
        assignments: [
          {
            id: "reserved-assignment",
            package_id: "local-package",
            email_address: "private-invite@example.com",
            metadata: {
              course_project_id: COURSE_PROJECT_ID,
              project_id: STUDENT_PROJECT_ID,
              student_id: STUDENT_ID,
            },
          },
        ],
        active_assignment_count: 1,
        available_seat_count: 29,
      },
    ]);
    interBayGetMembershipPackagesMock.mockResolvedValue([
      {
        id: "remote-package",
        owner_account_id: SECOND_MANAGER_ID,
        kind: "course",
        membership_class: "student",
        seat_count: 10,
        metadata: { course_project_id: COURSE_PROJECT_ID },
        assignments: [],
        active_assignment_count: 0,
        available_seat_count: 10,
      },
      {
        id: "other-course",
        owner_account_id: SECOND_MANAGER_ID,
        kind: "course",
        membership_class: "student",
        seat_count: 5,
        metadata: { course_project_id: "other" },
        assignments: [],
        active_assignment_count: 0,
        available_seat_count: 5,
      },
    ]);
    interBayGetMembershipMock.mockResolvedValue({
      class: "student",
      source: "grant",
      grant_source: "course-seat",
      entitlements: {},
    });

    const { getCoursePaymentOverview } = await import("./projects");
    const overview = await getCoursePaymentOverview({
      account_id: ACCOUNT_ID,
      course_project_id: COURSE_PROJECT_ID,
      student_project_ids: [STUDENT_PROJECT_ID],
    });

    expect(overview.course_title).toBe("Linear Algebra");
    expect(overview.packages.map(({ id }) => id).sort()).toEqual([
      "local-package",
      "remote-package",
    ]);
    expect(overview.students).toEqual([
      expect.objectContaining({
        project_id: STUDENT_PROJECT_ID,
        account_id: STUDENT_ACCOUNT_ID,
        status: "paid",
        source: "course-seat",
      }),
    ]);
    expect(interBayGetMembershipMock).toHaveBeenCalledWith({
      account_id: STUDENT_ACCOUNT_ID,
    });
    expect(overview.packages[0].assignments).toEqual([
      expect.objectContaining({
        id: "reserved-assignment",
        metadata: expect.objectContaining({ student_id: STUDENT_ID }),
      }),
    ]);
    expect(overview.packages[0].assignments[0].email_address).toBeUndefined();
    expect(
      claimMembershipPackageSeatWithVerifiedEmailsOnLocalBayMock,
    ).toHaveBeenCalledWith({
      package_id: "local-package",
      account_id: STUDENT_ACCOUNT_ID,
      verified_email_addresses: ["private-invite@example.com"],
    });
  });

  it("rejects payment overview access for non-course collaborators", async () => {
    resolveCourseReferenceMock.mockResolvedValue(null);
    const { getCoursePaymentOverview } = await import("./projects");
    await expect(
      getCoursePaymentOverview({
        account_id: ACCOUNT_ID,
        course_project_id: "33333333-3333-4333-8333-333333333333",
        student_project_ids: [],
      }),
    ).rejects.toThrow("user must be a collaborator on project");
    expect(listMembershipPackagesMock).not.toHaveBeenCalled();
  });

  it("returns project course info for a collaborator", async () => {
    const { getProjectCourseInfo } = await import("./projects");
    await expect(
      getProjectCourseInfo({
        account_id: ACCOUNT_ID,
        project_id: PROJECT_ID,
      }),
    ).resolves.toEqual({
      type: "student",
      project_id: "33333333-3333-4333-8333-333333333333",
      path: ".course/main.course",
    });
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("SELECT"), [
      PROJECT_ID,
    ]);
  });

  it("allows admins to read project course info without collaborator access", async () => {
    getLocalProjectCollaboratorAccessStatusMock = jest.fn(
      async () => "not-collaborator",
    );
    isAdminMock = jest.fn(async () => true);
    const { getProjectCourseInfo } = await import("./projects");
    await expect(
      getProjectCourseInfo({
        account_id: ACCOUNT_ID,
        project_id: PROJECT_ID,
      }),
    ).resolves.toEqual({
      type: "student",
      project_id: "33333333-3333-4333-8333-333333333333",
      path: ".course/main.course",
    });
    expect(isAdminMock).toHaveBeenCalledWith(ACCOUNT_ID);
  });
});
