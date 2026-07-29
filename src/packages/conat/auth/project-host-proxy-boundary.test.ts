/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { stripProjectHostProxyAuthCookies } from "./project-host-proxy-boundary";

describe("project-host proxy auth boundary", () => {
  it("removes edge credentials without changing application cookies", () => {
    expect(
      stripProjectHostProxyAuthCookies(
        [
          "cocalc_project_host_http_bearer=bearer",
          "app_session=keep-me",
          "cocalc_project_host_http_session=http-session",
          "cocalc_project_host_session=browser-session",
          "theme=dark",
        ].join("; "),
      ),
    ).toBe("app_session=keep-me; theme=dark");
  });

  it("only preserves an edge cookie when an internal hop requests it", () => {
    expect(
      stripProjectHostProxyAuthCookies(
        "cocalc_project_host_session=browser-session; app_session=keep-me",
        { preserveCookieNames: ["cocalc_project_host_session"] },
      ),
    ).toBe("cocalc_project_host_session=browser-session; app_session=keep-me");
  });
});
