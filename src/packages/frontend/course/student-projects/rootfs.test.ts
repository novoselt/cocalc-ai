/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { redux } from "@cocalc/frontend/app-framework";
import { setProjectRootfsImage } from "@cocalc/frontend/rootfs/manifest";
import { StudentProjectsActions } from "./actions";

jest.mock("@cocalc/frontend/rootfs/manifest", () => ({
  setProjectRootfsImage: jest.fn(async () => []),
}));

describe("StudentProjectsActions.set_all_student_project_rootfs", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(setProjectRootfsImage).mockClear();
  });

  it("updates and restarts student projects and the shared project", async () => {
    const restartProject = jest.fn(async () => undefined);
    jest.spyOn(redux, "getActions").mockReturnValue({
      restart_project: restartProject,
    } as any);
    jest.spyOn(redux, "getStore").mockReturnValue({
      get_state: () => "running",
    } as any);
    const store = {
      get_student_project_rootfs: () => ({
        image: "cocalc.local/rootfs/course-image",
        image_id: "course-image-id",
      }),
      get_student_project_ids: () => ["student-project-id"],
      get_shared_project_id: () => "shared-project-id",
    };
    const courseActions = {
      get_store: () => store,
      is_closed: () => false,
      set_activity: jest.fn(() => "activity-id"),
      set_error: jest.fn(),
    };
    const actions = new StudentProjectsActions(courseActions as any);
    jest
      .spyOn(actions, "set_all_student_project_course_info")
      .mockResolvedValue();

    await actions.set_all_student_project_rootfs();

    expect(jest.mocked(setProjectRootfsImage).mock.calls).toEqual([
      [
        {
          project_id: "student-project-id",
          image: "cocalc.local/rootfs/course-image",
          image_id: "course-image-id",
        },
      ],
      [
        {
          project_id: "shared-project-id",
          image: "cocalc.local/rootfs/course-image",
          image_id: "course-image-id",
        },
      ],
    ]);
    expect(restartProject.mock.calls).toEqual([
      ["student-project-id"],
      ["shared-project-id"],
    ]);
  });
});
