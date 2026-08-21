/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  browserRuntimePresenceSubject,
  parseBrowserRuntimePresenceSubject,
} from "./browser-runtime-presence";

describe("browser runtime presence subjects", () => {
  const project_id = "1fc5e846-547c-4c78-baa3-d0528685eea0";
  const account_id = "346bfe62-d415-47ec-a4d7-2cccf2b36104";

  it("round trips a project and account", () => {
    const subject = browserRuntimePresenceSubject({ project_id, account_id });
    expect(parseBrowserRuntimePresenceSubject(subject)).toEqual({
      project_id,
      account_id,
    });
  });

  it.each([
    "project.*.browser-runtime-presence.*",
    `project.${project_id}.browser-runtime-presence`,
    `project.${project_id}.touch.${account_id}`,
    `project.not-a-uuid.browser-runtime-presence.${account_id}`,
  ])("rejects malformed subject %s", (subject) => {
    expect(parseBrowserRuntimePresenceSubject(subject)).toBeUndefined();
  });
});
