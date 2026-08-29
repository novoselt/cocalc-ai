/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { planBackupRetention } from "./backup-retention";

const backups = [
  { id: "oldest", time: new Date("2026-01-01T00:00:00.000Z") },
  { id: "middle", time: new Date("2026-02-01T00:00:00.000Z") },
  { id: "newest", time: new Date("2026-03-01T00:00:00.000Z") },
];

describe("backup retention planning", () => {
  it("enforces the normal backup limit", () => {
    expect(planBackupRetention({ backups, limit: 3 })).toEqual({
      allowed: false,
      replace: [],
    });
    expect(
      planBackupRetention({ backups: backups.slice(0, 2), limit: 3 }),
    ).toEqual({ allowed: true, replace: [] });
  });

  it("replaces the oldest backup only after an archival backup can be made", () => {
    expect(
      planBackupRetention({
        backups,
        limit: 3,
        replaceOldestAtLimit: true,
      }),
    ).toEqual({ allowed: true, replace: [backups[0]] });
  });

  it("returns enough oldest backups when a repository is already over quota", () => {
    expect(
      planBackupRetention({
        backups,
        limit: 2,
        replaceOldestAtLimit: true,
      }),
    ).toEqual({ allowed: true, replace: backups.slice(0, 2) });
  });

  it("retains the new recovery backup when the entitlement limit is zero", () => {
    expect(
      planBackupRetention({
        backups,
        limit: 0,
        replaceOldestAtLimit: true,
      }),
    ).toEqual({ allowed: true, replace: backups });
  });
});
