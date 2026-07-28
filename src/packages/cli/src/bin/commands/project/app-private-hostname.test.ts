/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrivateHostnameBootstrapUrl,
  buildPrivateHostnameBrowserHandoffUrl,
} from "./app";

test("private hostname open adds a token without changing the route", () => {
  assert.equal(
    buildPrivateHostnameBootstrapUrl(
      "https://dev-1234.cocalc.ai/?next=%2Fprojects",
      "short lived/token",
    ),
    "https://dev-1234.cocalc.ai/?next=%2Fprojects&cocalc_project_host_token=short+lived%2Ftoken",
  );
});

test("private hostname open replaces an existing bootstrap token", () => {
  assert.equal(
    buildPrivateHostnameBootstrapUrl(
      "https://dev-1234.cocalc.ai/?cocalc_project_host_token=old",
      "new",
    ),
    "https://dev-1234.cocalc.ai/?cocalc_project_host_token=new",
  );
});

test("project-scoped private hostname open uses the authenticated site origin", () => {
  assert.equal(
    buildPrivateHostnameBrowserHandoffUrl({
      appId: "cocalc-dev-main",
      browserOrigin: "https://staging.cocalc.ai/",
      projectId: "af027aca-e308-41c2-b528-a3e73de50996",
    }),
    "https://staging.cocalc.ai/projects/af027aca-e308-41c2-b528-a3e73de50996/private-app/cocalc-dev-main",
  );
});

test("project-scoped private hostname open requires a browser origin", () => {
  assert.throws(
    () =>
      buildPrivateHostnameBrowserHandoffUrl({
        appId: "cocalc-dev-main",
        projectId: "af027aca-e308-41c2-b528-a3e73de50996",
      }),
    /public browser origin/,
  );
});
