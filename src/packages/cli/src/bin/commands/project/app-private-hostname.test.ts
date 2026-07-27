/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildPrivateHostnameBootstrapUrl } from "./app";

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
