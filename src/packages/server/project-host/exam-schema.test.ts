/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const queryMock = jest.fn(async () => ({ rows: [] }));

jest.mock("@cocalc/backend/data", () => ({
  conatPassword: "exam-test-secret",
}));

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query: queryMock }),
}));

import { __test__ } from "./exam";

describe("project-host exam schema", () => {
  it("repairs timestamp defaults created by the generic schema synchronizer", async () => {
    await __test__.ensureSchema();

    const sql = queryMock.mock.calls.map(([query]) => query).join("\n");
    expect(sql).toContain(
      "SET created_at=COALESCE(created_at, updated_at, NOW())",
    );
    expect(sql).toContain("ALTER COLUMN created_at SET DEFAULT NOW()");
    expect(sql).toContain("ALTER COLUMN created_at SET NOT NULL");
    expect(sql).toContain("ALTER COLUMN updated_at SET DEFAULT NOW()");
    expect(sql).toContain("ALTER COLUMN updated_at SET NOT NULL");
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS stop_host_at_deadline BOOLEAN DEFAULT TRUE",
    );
    expect(sql).toContain("ALTER COLUMN stop_host_at_deadline SET NOT NULL");
  });
});
