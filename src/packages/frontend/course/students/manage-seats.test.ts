/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { MembershipPackageDetails } from "@cocalc/conat/hub/api/purchases";
import {
  getManageSeatsAssignmentMatches,
  getNextManageSeatsPagination,
  MANAGE_SEATS_MODAL_BODY_STYLE,
  runSeatChangesWithConcurrency,
  type ManageSeatsStudent,
} from "./manage-seats";

const student: ManageSeatsStudent = {
  student_id: "student-1",
  account_id: "account-1",
  project_id: "project-1",
  email_address: "student@example.com",
};

function packageWithAssignment({
  id,
  student_id = student.student_id,
  account_id = student.account_id,
  revoked = false,
}: {
  id: string;
  student_id?: string;
  account_id?: string;
  revoked?: boolean;
}): MembershipPackageDetails {
  return {
    id,
    owner_account_id: `owner-${id}`,
    kind: "course",
    membership_class: "student",
    seat_count: 10,
    active_assignment_count: revoked ? 0 : 1,
    available_seat_count: revoked ? 10 : 9,
    assignments: [
      {
        id: `assignment-${id}`,
        package_id: id,
        account_id,
        revoked_at: revoked ? new Date() : undefined,
        metadata: {
          student_id,
          project_id: student.project_id,
        },
      },
    ],
  };
}

describe("ManageSeats", () => {
  it("contains long seat tables in a viewport-bounded scrolling body", () => {
    expect(MANAGE_SEATS_MODAL_BODY_STYLE).toEqual({
      maxHeight: "calc(100vh - 180px)",
      overflowX: "hidden",
      overflowY: "auto",
    });
  });

  it("finds active assignments across every linked package", () => {
    const first = packageWithAssignment({ id: "package-1" });
    const second = packageWithAssignment({ id: "package-2" });
    const revoked = packageWithAssignment({ id: "package-3", revoked: true });
    const unrelated = packageWithAssignment({
      id: "package-4",
      student_id: "another-student",
      account_id: "another-account",
    });

    expect(
      getManageSeatsAssignmentMatches(
        [first, second, revoked, unrelated],
        student,
      ).map(({ membershipPackage }) => membershipPackage.id),
    ).toEqual(["package-1", "package-2"]);
  });

  it("keeps the selected page unless the page size changes", () => {
    expect(
      getNextManageSeatsPagination({
        page: 3,
        pageSize: 20,
        previousPageSize: 20,
      }),
    ).toEqual({ current: 3, pageSize: 20 });
    expect(
      getNextManageSeatsPagination({
        page: 3,
        pageSize: 100,
        previousPageSize: 20,
      }),
    ).toEqual({ current: 1, pageSize: 100 });
  });

  it("propagates fresh-auth failures so the verification modal can retry", async () => {
    const ordinaryFailure = new Error("student is missing an account");
    const freshAuthFailure = Object.assign(
      new Error("fresh auth is required"),
      {
        code: "fresh_auth_required",
      },
    );

    await expect(
      runSeatChangesWithConcurrency(
        [ordinaryFailure, freshAuthFailure],
        2,
        (e) => Promise.reject(e),
      ),
    ).rejects.toBe(freshAuthFailure);
    await expect(
      runSeatChangesWithConcurrency([ordinaryFailure], 1, (e) =>
        Promise.reject(e),
      ),
    ).resolves.toEqual([ordinaryFailure]);
  });
});
