/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  MembershipPackageAssignment,
  MembershipPackageDetails,
} from "@cocalc/conat/hub/api/purchases";

function toTime(value?: Date | string | null): number {
  if (value == null) {
    return 0;
  }
  const time =
    value instanceof Date ? value.valueOf() : new Date(value).valueOf();
  return Number.isFinite(time) ? time : 0;
}

export function isMembershipPackageCurrentlyActive(
  membershipPackage: MembershipPackageDetails | undefined,
  now = Date.now(),
): boolean {
  if (!membershipPackage) {
    return false;
  }
  const startsAt = toTime(membershipPackage.starts_at);
  const expiresAt = toTime(membershipPackage.expires_at);
  return (!startsAt || startsAt <= now) && (!expiresAt || expiresAt > now);
}

export function isActiveMembershipPackageAssignment(
  assignment?: MembershipPackageAssignment | null,
): boolean {
  return !!assignment && !assignment.revoked_at;
}

export function isCourseMembershipPackageForProject(
  membershipPackage: MembershipPackageDetails | undefined,
  course_project_id: string,
): boolean {
  return (
    membershipPackage?.kind === "course" &&
    membershipPackage?.metadata?.course_project_id === course_project_id
  );
}

export function getCourseMembershipPackage(
  packages: MembershipPackageDetails[],
  course_project_id: string,
): MembershipPackageDetails | undefined {
  return packages
    .filter((membershipPackage) =>
      isCourseMembershipPackageForProject(membershipPackage, course_project_id),
    )
    .sort(
      (left, right) =>
        Number(isMembershipPackageCurrentlyActive(right)) -
          Number(isMembershipPackageCurrentlyActive(left)) ||
        toTime(right.updated) - toTime(left.updated) ||
        toTime(right.created) - toTime(left.created),
    )[0];
}

export function getActiveMembershipPackageAssignmentForAccount(
  membershipPackage: MembershipPackageDetails | undefined,
  account_id: string | undefined,
): MembershipPackageAssignment | undefined {
  if (!membershipPackage || !account_id) {
    return;
  }
  return membershipPackage.assignments.find(
    (assignment) =>
      assignment.account_id === account_id &&
      isActiveMembershipPackageAssignment(assignment),
  );
}

export function getActiveMembershipPackageAssignmentForStudent(
  membershipPackage: MembershipPackageDetails | undefined,
  student: {
    account_id?: string;
    project_id?: string;
    student_id: string;
  },
): MembershipPackageAssignment | undefined {
  if (!membershipPackage) {
    return;
  }
  return membershipPackage.assignments.find((assignment) => {
    if (!isActiveMembershipPackageAssignment(assignment)) {
      return false;
    }
    if (student.account_id && assignment.account_id === student.account_id) {
      return true;
    }
    return (
      assignment.metadata?.student_id === student.student_id &&
      (!student.project_id ||
        assignment.metadata?.project_id === student.project_id)
    );
  });
}
