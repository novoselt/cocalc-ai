/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

export function loadUltraliteSession() {
  return new Promise<typeof import("./session")>((resolve, reject) => {
    require.ensure(
      [],
      () => resolve(require("./session")),
      reject,
      "ultralite-session",
    );
  });
}
