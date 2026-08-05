/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  legacyMigrationProjectHref,
  legacyMigrationProjectQuery,
} from "./legacy-migration-link";

describe("legacy migration project links", () => {
  it("links directly to a legacy project search", () => {
    const href = legacyMigrationProjectHref(" legacy/project id ");
    expect(href).toBe(
      "/settings/legacy-migration?legacy_project_id=legacy%2Fproject+id",
    );
    expect(legacyMigrationProjectQuery(href.split("?")[1])).toBe(
      "legacy/project id",
    );
  });

  it("returns an empty query when no project was selected", () => {
    expect(legacyMigrationProjectQuery("?other=value")).toBe("");
  });
});
