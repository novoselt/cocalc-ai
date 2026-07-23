/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { db } from "@cocalc/database";
import getPool, { initEphemeralDatabase } from "@cocalc/database/pool";
import { webapp_error } from "@cocalc/database/postgres/log-query";

import {
  readWebappCrashesLocal,
  setWebappCrashResolutionLocal,
} from "./webapp-crashes";

const ADMIN_ID = "22222222-2222-4222-8222-222222222222";

describe("webapp crash diagnostics database integration", () => {
  beforeAll(async () => {
    await initEphemeralDatabase({});
  }, 15_000);

  afterAll(async () => {
    await getPool().end();
  });

  it("reads a legacy crash row and resolves/reopens its signature", async () => {
    await webapp_error(db(), {
      name: "TypeError",
      message: "integration crash",
      stacktrace: "TypeError: integration crash\n at test (app.js:1:2)",
      path: "https://cocalc.test/projects/11111111-1111-4111-8111-111111111111/files/private.txt",
      smc_git_rev: "integration-revision",
      lineNumber: 1,
      columnNumber: 2,
    });

    const open = await readWebappCrashesLocal({ status: "open", limit: 10 });
    const report = open.reports.find(
      ({ message }) => message === "integration crash",
    );
    expect(report).toBeDefined();
    expect(report!.resolution).toBeNull();

    const solved = await setWebappCrashResolutionLocal({
      report_id: report!.id,
      solved: true,
      actor_account_id: ADMIN_ID,
      note: "integration fix",
    });
    expect(solved.resolution).toMatchObject({
      status: "solved",
      note: "integration fix",
    });

    const solvedRows = await readWebappCrashesLocal({
      status: "solved",
      limit: 10,
    });
    expect(solvedRows.reports.map(({ id }) => id)).toContain(report!.id);

    const reopened = await setWebappCrashResolutionLocal({
      report_id: report!.id,
      solved: false,
      actor_account_id: ADMIN_ID,
      note: "regressed",
    });
    expect(reopened.resolution).toBeNull();
  });
});
