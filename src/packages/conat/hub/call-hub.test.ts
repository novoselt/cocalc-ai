/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { annotateCallHubError } from "./call-hub";

describe("annotateCallHubError", () => {
  const context = {
    subject: "hub.account.account-1.api",
    name: "projects.getProjectRootfs",
  };

  it("preserves an Error while replacing a missing message", () => {
    const err = Object.assign(new Error("temporary"), { code: 503 });
    err.message = undefined as any;

    const annotated = annotateCallHubError({ err, ...context });

    expect(annotated).toBe(err);
    expect(annotated.message).toBe(
      "hub request failed - callHub: subject='hub.account.account-1.api', name='projects.getProjectRootfs', code='503'",
    );
    expect((annotated as any).code).toBe(503);
  });

  it("uses an error field from a non-Error rejection", () => {
    const annotated = annotateCallHubError({
      err: { error: "project is unavailable", code: "PROJECT_UNAVAILABLE" },
      ...context,
    });

    expect(annotated).toBeInstanceOf(Error);
    expect(annotated.message).toBe(
      "project is unavailable - callHub: subject='hub.account.account-1.api', name='projects.getProjectRootfs', code='PROJECT_UNAVAILABLE'",
    );
    expect((annotated as any).code).toBe("PROJECT_UNAVAILABLE");
  });

  it("gives an undefined rejection a useful fallback", () => {
    expect(annotateCallHubError({ err: undefined, ...context }).message).toBe(
      "hub request failed - callHub: subject='hub.account.account-1.api', name='projects.getProjectRootfs', code='unknown'",
    );
  });
});
