/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { ConatError, headerToError } from "./util";

describe("headerToError", () => {
  it("creates a typed Conat error with response attributes", () => {
    const err = headerToError({
      error: "project not found",
      error_attrs: { subject: "hub.project.project-1.api" },
      code: 404,
    });

    expect(err).toBeInstanceOf(ConatError);
    expect(err.message).toBe("project not found");
    expect(err.subject).toBe("hub.project.project-1.api");
    expect(err.code).toBe(404);
  });

  it("uses a useful fallback for malformed error headers", () => {
    const err = headerToError({
      error: undefined,
      error_attrs: { message: undefined },
    });

    expect(err.message).toBe("Conat request failed");
  });

  it("extracts a message from an Error-valued header", () => {
    expect(
      headerToError({ error: new Error("transport closed") }).message,
    ).toBe("transport closed");
  });
});
