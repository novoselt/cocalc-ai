/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { projectArchiveReasonText } from "./archive-lifecycle";

describe("projectArchiveReasonText", () => {
  it("describes automatic inactivity archives", () => {
    expect(projectArchiveReasonText({ reason: "free-inactive" })).toBe(
      "Archived automatically after prolonged inactivity.",
    );
  });

  it("describes banned collaborator archives", () => {
    expect(
      projectArchiveReasonText({ reason: "all-collaborators-banned" }),
    ).toBe("Archived because all collaborators were banned.");
  });

  it("returns undefined for legacy archives without a reason", () => {
    expect(projectArchiveReasonText({})).toBeUndefined();
  });
});
