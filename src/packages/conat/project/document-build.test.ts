/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { documentBuildEventsSubject } from "./document-build";

describe("documentBuildEventsSubject", () => {
  it("uses a project-local subject", () => {
    expect(
      documentBuildEventsSubject({
        project_id: "812abe34-a382-4bd1-9071-29b6f4334f03",
      }),
    ).toBe(
      "project.812abe34-a382-4bd1-9071-29b6f4334f03.document-build-events.-",
    );
  });
});
