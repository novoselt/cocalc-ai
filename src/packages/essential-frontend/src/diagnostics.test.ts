/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import {
  essentialDiagnosticErrorDetails,
  essentialDiagnosticsSnapshot,
  recordEssentialDiagnostic,
} from "./diagnostics";

test("exposes bounded, copied Essential diagnostics", () => {
  const before = essentialDiagnosticsSnapshot().events.at(-1)?.sequence ?? 0;
  for (let index = 0; index < 205; index += 1) {
    recordEssentialDiagnostic("notebook", "state", {
      index,
      label: "x".repeat(300),
      omitted: undefined,
    });
  }

  const snapshot = essentialDiagnosticsSnapshot();
  expect(snapshot.version).toBe(1);
  expect(snapshot.events).toHaveLength(200);
  expect(snapshot.events[0].sequence).toBe(before + 6);
  expect(snapshot.events.at(-1)?.details?.label).toHaveLength(160);

  snapshot.events[0].event = "mutated";
  expect(essentialDiagnosticsSnapshot().events[0].event).toBe("state");
  expect(window.__COCALC_ESSENTIAL_DIAGNOSTICS__?.snapshot().version).toBe(1);
});

test("reports errors without copying messages", () => {
  const error = Object.assign(new Error("private notebook contents"), {
    code: "ETIMEDOUT",
  });

  expect(essentialDiagnosticErrorDetails(error)).toEqual({
    error_code: "ETIMEDOUT",
    error_name: "Error",
  });
});
