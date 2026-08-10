/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { activityFlagsForEvent, __test__ } from "./materialize";

describe("growth analytics materialization semantics", () => {
  it("makes meaningful work imply foreground project engagement", () => {
    expect(activityFlagsForEvent("project_work")).toEqual({
      app_foreground: true,
      project_engaged: true,
      project_work: true,
      self_directed_work: false,
      ai_engaged: false,
    });
  });

  it("classifies AI prompts and self-directed work independently", () => {
    expect(activityFlagsForEvent("ai_prompt_submitted")).toMatchObject({
      project_work: true,
      ai_engaged: true,
      self_directed_work: false,
    });
    expect(activityFlagsForEvent("first_self_directed_work")).toMatchObject({
      project_work: true,
      ai_engaged: false,
      self_directed_work: true,
    });
  });

  it("parses restart-safe watermarks defensively", () => {
    expect(
      __test__.parseWatermark({
        received_at: "2026-08-09T12:00:00.000Z",
        event_id: "event",
        ignored: 1,
      }),
    ).toEqual({
      received_at: "2026-08-09T12:00:00.000Z",
      event_id: "event",
    });
    expect(__test__.parseWatermark(null)).toEqual({});
  });
});
