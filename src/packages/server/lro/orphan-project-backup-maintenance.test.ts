/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const listCandidatesMock = jest.fn();
const finishChecksMock = jest.fn();
const hardDeleteStatusMock = jest.fn();
const localHardDeleteStatusMock = jest.fn();

jest.mock("./lro-db", () => ({
  listQueuedProjectBackupLroDeletionCandidates: (...args: any[]) =>
    listCandidatesMock(...args),
  finishProjectBackupLroDeletionChecks: (...args: any[]) =>
    finishChecksMock(...args),
}));

jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => "bay-home",
}));

jest.mock("@cocalc/server/inter-bay/bridge", () => ({
  getInterBayBridge: () => ({
    projectControl: () => ({ hardDeleteStatus: hardDeleteStatusMock }),
  }),
}));

jest.mock("@cocalc/server/projects/hard-delete-evidence", () => ({
  getAuthoritativeProjectHardDeleteStatus: (...args: any[]) =>
    localHardDeleteStatusMock(...args),
}));

import { expireOrphanedProjectBackupLros } from "./orphan-project-backup-maintenance";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OP_ID = "22222222-2222-4222-8222-222222222222";

function candidate(owning_bay_id = "bay-owner") {
  return {
    op_id: OP_ID,
    kind: "project-backup",
    scope_type: "project",
    scope_id: PROJECT_ID,
    status: "queued",
    input: { owning_bay_id },
  };
}

describe("orphan project backup maintenance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    finishChecksMock.mockResolvedValue([]);
  });

  it.each(["live", "unknown"] as const)(
    "retains a remote-owned project when its owning bay reports %s",
    async (status) => {
      listCandidatesMock.mockResolvedValue([candidate()]);
      hardDeleteStatusMock.mockResolvedValue({
        project_id: PROJECT_ID,
        bay_id: "bay-owner",
        status,
      });

      await expect(expireOrphanedProjectBackupLros()).resolves.toEqual([]);
      expect(finishChecksMock).toHaveBeenCalledWith({
        checked_op_ids: [OP_ID],
        hard_deleted_op_ids: [],
      });
    },
  );

  it("expires a remote backup only after the owning bay confirms its tombstone", async () => {
    listCandidatesMock.mockResolvedValue([candidate()]);
    hardDeleteStatusMock.mockResolvedValue({
      project_id: PROJECT_ID,
      bay_id: "bay-owner",
      status: "hard-deleted",
    });

    await expireOrphanedProjectBackupLros({ limit: 25, min_age_ms: 1000 });
    expect(listCandidatesMock).toHaveBeenCalledWith({
      limit: 25,
      min_age_ms: 1000,
    });
    expect(finishChecksMock).toHaveBeenCalledWith({
      checked_op_ids: [OP_ID],
      hard_deleted_op_ids: [OP_ID],
    });
  });

  it("uses local authoritative evidence for a locally owned project", async () => {
    listCandidatesMock.mockResolvedValue([candidate("bay-home")]);
    localHardDeleteStatusMock.mockResolvedValue({
      project_id: PROJECT_ID,
      bay_id: "bay-home",
      status: "hard-deleted",
    });

    await expireOrphanedProjectBackupLros();
    expect(hardDeleteStatusMock).not.toHaveBeenCalled();
    expect(finishChecksMock).toHaveBeenCalledWith({
      checked_op_ids: [OP_ID],
      hard_deleted_op_ids: [OP_ID],
    });
  });

  it("fails closed when the recorded owning bay is unreachable", async () => {
    listCandidatesMock.mockResolvedValue([candidate()]);
    hardDeleteStatusMock.mockRejectedValue(new Error("bay unavailable"));

    await expect(expireOrphanedProjectBackupLros()).resolves.toEqual([]);
    expect(finishChecksMock).toHaveBeenCalledWith({
      checked_op_ids: [OP_ID],
      hard_deleted_op_ids: [],
    });
  });

  it("fails closed when a different bay claims the tombstone", async () => {
    listCandidatesMock.mockResolvedValue([candidate()]);
    hardDeleteStatusMock.mockResolvedValue({
      project_id: PROJECT_ID,
      bay_id: "bay-other",
      status: "hard-deleted",
    });

    await expect(expireOrphanedProjectBackupLros()).resolves.toEqual([]);
    expect(finishChecksMock).toHaveBeenCalledWith({
      checked_op_ids: [OP_ID],
      hard_deleted_op_ids: [],
    });
  });

  it("fails closed when a response refers to a different project", async () => {
    listCandidatesMock.mockResolvedValue([candidate()]);
    hardDeleteStatusMock.mockResolvedValue({
      project_id: "33333333-3333-4333-8333-333333333333",
      bay_id: "bay-owner",
      status: "hard-deleted",
    });

    await expect(expireOrphanedProjectBackupLros()).resolves.toEqual([]);
    expect(finishChecksMock).toHaveBeenCalledWith({
      checked_op_ids: [OP_ID],
      hard_deleted_op_ids: [],
    });
  });
});
