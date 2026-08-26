/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const query = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query }),
  withSessionAdvisoryLock: jest.fn(),
}));
jest.mock("@cocalc/database/settings/server-settings", () => ({
  getServerSettings: jest.fn(),
}));
jest.mock("@cocalc/server/account/project-feed", () => ({
  publishProjectAccountFeedEventsBestEffort: jest.fn(),
}));
jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => "bay-0",
}));
jest.mock("@cocalc/server/inter-bay/directory", () => ({
  resolveProjectBayDirect: jest.fn(),
}));
jest.mock("./archive", () => ({
  archiveProjectStorage: jest.fn(),
  ProjectArchiveStorageError: class extends Error {},
}));
jest.mock("./archive-lifecycle-accounts", () => ({
  resolveArchiveLifecycleAccountStatuses: jest.fn(),
}));
jest.mock("./archive-lifecycle-db", () => ({}));
jest.mock("./archive-lifecycle-schema", () => ({
  ensureProjectArchiveLifecycleSchema: jest.fn(),
}));

import { __test__ } from "./archive-lifecycle-maintenance";
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
