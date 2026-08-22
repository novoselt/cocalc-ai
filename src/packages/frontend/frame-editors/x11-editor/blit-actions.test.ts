/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { openProjectDocs } from "@cocalc/frontend/docs/navigation";
import { Actions, GRAPHICAL_APPLICATIONS_HELP_SLUG } from "./blit-actions";

jest.mock("@cocalc/frontend/docs/navigation", () => ({
  openProjectDocs: jest.fn(),
}));

describe("Blit editor actions", () => {
  it("opens the graphical applications documentation", () => {
    const actions = Object.create(Actions.prototype) as Actions;
    Object.defineProperty(actions, "project_id", { value: "project-id" });

    actions.help();

    expect(openProjectDocs).toHaveBeenCalledWith({
      projectId: "project-id",
      slug: GRAPHICAL_APPLICATIONS_HELP_SLUG,
    });
  });
});
