/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  PROJECT_DISK_QUOTA_EXCEEDED_CODE,
  isProjectDiskQuotaError,
  projectStartFailureFromError,
} from "./project-start-errors";

describe("project start errors", () => {
  it("recognizes structured and legacy project disk quota errors", () => {
    expect(
      isProjectDiskQuotaError({ code: PROJECT_DISK_QUOTA_EXCEEDED_CODE }),
    ).toBe(true);
    expect(
      isProjectDiskQuotaError(
        new Error("Project disk quota is full; delete files and retry"),
      ),
    ).toBe(true);
    expect(isProjectDiskQuotaError(new Error("network unavailable"))).toBe(
      false,
    );
  });

  it("creates a stable structured failure", () => {
    expect(
      projectStartFailureFromError(new Error("disk quota exceeded")),
    ).toEqual({ code: PROJECT_DISK_QUOTA_EXCEEDED_CODE });
    expect(projectStartFailureFromError(new Error("other failure"))).toBe(
      undefined,
    );
  });
});
