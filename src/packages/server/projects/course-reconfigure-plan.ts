/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export function shouldCreateCourseStudentProject({
  knownBayId,
  admissionCreate,
}: {
  knownBayId?: string;
  admissionCreate: boolean;
}): boolean {
  if (knownBayId) {
    return false;
  }
  if (admissionCreate) {
    return true;
  }
  // Admission may recover an id allocated by a prior attempt whose creation
  // failed. Project existence, not that historical hint, is authoritative.
  return true;
}
