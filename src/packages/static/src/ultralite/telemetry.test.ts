/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { recordUltraliteOutcome, ultraliteTelemetryDetails } from "./telemetry";

test("emits only content-free constrained-client fields", async () => {
  const request = jest.fn(async (_input: unknown, _options?: RequestInit) => ({
    ok: true,
  }));
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: request,
  });
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: jest.fn(() => false),
  });

  recordUltraliteOutcome("file", "file_open");
  await Promise.resolve();

  expect(request).toHaveBeenCalledTimes(1);
  const options = request.mock.calls[0][1];
  expect(options).toBeDefined();
  const payload = JSON.parse(`${options?.body}`);
  expect(payload).toMatchObject({
    metric: "constrained_outcome_v1",
    segment: "file",
    details: { client: "ultralite", outcome: "file_open", surface: "file" },
  });
  expect(JSON.stringify(payload)).not.toMatch(
    /project_id|host_id|path|filename|prompt|content|token/i,
  );
});

test("summarizes browser capabilities without route identifiers", () => {
  const details = ultraliteTelemetryDetails("projects");
  expect(details).toMatchObject({ client: "ultralite", surface: "projects" });
  expect(details).not.toHaveProperty("project_id");
  expect(details).not.toHaveProperty("path");
});
