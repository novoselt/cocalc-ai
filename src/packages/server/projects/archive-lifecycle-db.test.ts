/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const query = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query }),
}));

jest.mock("./archive-lifecycle-schema", () => ({
  ensureProjectArchiveLifecycleSchema: jest.fn(async () => undefined),
  PROJECT_ARCHIVE_LIFECYCLE_TABLE: "project_archive_lifecycle_jobs",
}));

import {
  createProjectArchiveLifecycleJob,
  updateProjectArchiveLifecycleJob,
} from "./archive-lifecycle-db";
import type { ArchiveLifecycleProjectSnapshot } from "./archive-lifecycle-types";

const project: ArchiveLifecycleProjectSnapshot = {
  project_id: "44444444-4444-4444-8444-444444444444",
  owning_bay_id: "bay-1",
  host_id: "33333333-3333-4333-8333-333333333333",
  host_status: "active",
  deleted: null,
  provisioned: true,
  deletion_protection: false,
  state: { state: "opened" },
  users: {},
  created: "2026-01-01T00:00:00.000Z",
  last_edited: "2026-07-01T00:00:00.000Z",
  last_changed: "2026-07-01T00:00:00.000Z",
  last_changed_generation: 10,
  last_backup: "2026-07-02T00:00:00.000Z",
  last_backup_generation: 10,
  backup_repo_id: "55555555-5555-4555-8555-555555555555",
  archive_lifecycle_job_id: null,
  active_published_path: false,
};

describe("project archive lifecycle job persistence", () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it("casts the shared status parameter consistently", async () => {
    await createProjectArchiveLifecycleJob({
      project,
      reason: "free-inactive",
      reportOnly: true,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0];
    expect(sql).toContain("$7::VARCHAR(32)");
    expect(sql.match(/\$7::VARCHAR\(32\)/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\$7(?!::VARCHAR\(32\))/);
    expect(parameters[6]).toBe("report-only");
  });

  it("casts every terminal status parameter reference consistently", async () => {
    await updateProjectArchiveLifecycleJob({
      job_id: "66666666-6666-4666-8666-666666666666",
      status: "completed",
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0];
    expect(sql.match(/\$2::VARCHAR\(32\)/g)).toHaveLength(3);
    expect(sql).not.toMatch(/\$2(?!::VARCHAR\(32\))/);
    expect(parameters[1]).toBe("completed");
  });
});
