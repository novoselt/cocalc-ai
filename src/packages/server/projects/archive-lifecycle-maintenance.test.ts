/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const query = jest.fn();
const mockArchiveProjectStorage = jest.fn();
const mockClaimProjectArchiveLifecycleJob = jest.fn();
const mockClaimRetainedProjectArchiveLifecycleJob = jest.fn();
const mockGetServerSettings = jest.fn();
const mockListRecoverableProjectArchiveLifecycleJobs = jest.fn();
const mockResolveProjectBayDirect = jest.fn();
const mockUpdateProjectArchiveLifecycleJob = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query }),
  withSessionAdvisoryLock: jest.fn(),
}));
jest.mock("@cocalc/database/settings/server-settings", () => ({
  getServerSettings: mockGetServerSettings,
}));
jest.mock("@cocalc/server/account/project-feed", () => ({
  publishProjectAccountFeedEventsBestEffort: jest.fn(),
}));
jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => "bay-0",
}));
jest.mock("@cocalc/server/inter-bay/directory", () => ({
  resolveProjectBayDirect: mockResolveProjectBayDirect,
}));
jest.mock("./archive", () => ({
  archiveProjectStorage: mockArchiveProjectStorage,
  ProjectArchiveStorageError: class extends Error {},
}));
jest.mock("./archive-lifecycle-accounts", () => ({
  resolveArchiveLifecycleAccountStatuses: jest.fn(),
}));
jest.mock("./archive-lifecycle-db", () => ({
  claimProjectArchiveLifecycleJob: mockClaimProjectArchiveLifecycleJob,
  claimRetainedProjectArchiveLifecycleJob:
    mockClaimRetainedProjectArchiveLifecycleJob,
  countRecentAutomaticArchives: jest.fn(),
  countRunningArchivesByHost: jest.fn(),
  createProjectArchiveLifecycleJob: jest.fn(),
  listQueuedProjectArchiveLifecycleJobs: jest.fn(),
  listRecoverableProjectArchiveLifecycleJobs:
    mockListRecoverableProjectArchiveLifecycleJobs,
  updateProjectArchiveLifecycleJob: mockUpdateProjectArchiveLifecycleJob,
}));
jest.mock("./archive-lifecycle-schema", () => ({
  ensureProjectArchiveLifecycleSchema: jest.fn(),
}));

import {
  __test__,
  runProjectArchiveLifecycleOnce,
} from "./archive-lifecycle-maintenance";
import type { ProjectArchiveLifecycleConfig } from "./archive-lifecycle-types";

const config: ProjectArchiveLifecycleConfig = {
  enabled: true,
  reportOnly: true,
  freeAfterDays: 30,
  bannedAfterDays: 7,
  batchLimit: 1,
  globalPerHour: 10,
  perHostConcurrency: 1,
  canaryBays: [],
  canaryHosts: [],
};

describe("project archive lifecycle candidate selector", () => {
  beforeEach(() => {
    query.mockReset();
    __test__.resetCandidateCursor();
  });

  it("uses indexed independent sources and preserves cursor precision", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          project_id: "11111111-1111-4111-8111-111111111111",
          candidate_order_at: new Date("2026-06-23T04:28:55.473Z"),
          candidate_cursor_at: "2026-06-23 04:28:55.473123",
        },
      ],
    });

    await __test__.listCandidateSnapshots({ config });

    const [sql, firstParams] = query.mock.calls[0];
    expect(sql).toContain("candidate_ids AS MATERIALIZED");
    expect(sql).toContain("p.users ?|");
    expect(sql).not.toContain("jsonb_object_keys");
    expect(firstParams.slice(3)).toEqual([null, null]);

    query.mockResolvedValueOnce({ rows: [] });
    await __test__.listCandidateSnapshots({ config });
    const secondParams = query.mock.calls[1][1];
    expect(secondParams.slice(3)).toEqual([
      "2026-06-23 04:28:55.473123",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });
});

describe("project archive lifecycle recovery", () => {
  beforeEach(() => {
    query.mockReset();
    mockArchiveProjectStorage.mockReset();
    mockClaimProjectArchiveLifecycleJob.mockReset();
    mockClaimRetainedProjectArchiveLifecycleJob.mockReset();
    mockGetServerSettings.mockReset();
    mockListRecoverableProjectArchiveLifecycleJobs.mockReset();
    mockResolveProjectBayDirect.mockReset();
    mockUpdateProjectArchiveLifecycleJob.mockReset();
  });

  it("recovers a retained archiving claim when automatic selection is disabled", async () => {
    const job = {
      id: "66666666-6666-4666-8666-666666666666",
      project_id: "44444444-4444-4444-8444-444444444444",
      owning_bay_id: "bay-0",
      host_id: "33333333-3333-4333-8333-333333333333",
      reason: "free-inactive" as const,
      policy_version: -1,
      status: "failed" as const,
      report_only: false,
      attempts: 1,
      thresholds: { free_after_days: 999 },
      final_backup_id: null,
      backup_generation: null,
      backup_time: null,
    };
    mockGetServerSettings.mockResolvedValue({
      automatic_project_archiving_enabled: false,
    });
    mockListRecoverableProjectArchiveLifecycleJobs.mockResolvedValue([job]);
    mockClaimRetainedProjectArchiveLifecycleJob.mockResolvedValue(true);
    mockResolveProjectBayDirect.mockResolvedValue({
      bay_id: "bay-0",
      epoch: 4,
    });
    query.mockResolvedValue({
      rows: [
        {
          project_id: job.project_id,
          owning_bay_id: "bay-0",
          ownership_epoch: 4,
          host_id: job.host_id,
          host_status: "active",
          deleted: null,
          provisioned: true,
          deletion_protection: false,
          state: { state: "archiving" },
          users: {},
          created: "2026-01-01T00:00:00.000Z",
          last_edited: "2026-01-01T00:00:00.000Z",
          last_changed: "2026-01-01T00:00:00.000Z",
          last_changed_generation: 10,
          last_backup: "2026-01-02T00:00:00.000Z",
          last_backup_generation: 10,
          backup_repo_id: "55555555-5555-4555-8555-555555555555",
          archive_lifecycle_job_id: job.id,
          active_published_path: false,
        },
      ],
    });
    mockArchiveProjectStorage.mockResolvedValue(undefined);

    const result = await runProjectArchiveLifecycleOnce();

    expect(result.enabled).toBe(false);
    expect(result.completed).toBe(1);
    expect(mockArchiveProjectStorage).toHaveBeenCalledWith({
      project_id: job.project_id,
      mode: "automatic",
      job_id: job.id,
      reason: job.reason,
      expected_host_id: job.host_id,
    });
  });
});
