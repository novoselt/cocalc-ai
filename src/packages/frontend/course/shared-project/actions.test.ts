/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { redux } from "@cocalc/frontend/app-framework";
import { SharedProjectActions } from "./actions";

jest.mock("awaiting", () => ({
  delay: jest.fn(async () => undefined),
}));

describe("SharedProjectActions.create", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates the shared project with the course student-project RootFS", async () => {
    const createProject = jest.fn(async () => "shared-project-id");
    jest.spyOn(redux, "getActions").mockReturnValue({
      create_project: createProject,
    } as any);
    const settings = {
      get: (key: string) =>
        key === "title" ? "Math 101" : key === "description" ? "Course" : null,
    };
    const store = {
      get: (key: string) => {
        if (key === "settings") return settings;
        if (key === "course_project_id") return "course-project-id";
        if (key === "course_filename") return "math101.course";
      },
      get_datastore: () => undefined,
      get_envvars: () => undefined,
      get_shared_project_id: () => undefined,
      getIn: () => undefined,
    };
    const getStudentProjectRootfs = jest.fn(async () => ({
      image: "cocalc.local/rootfs/course-image",
      image_id: "course-image-id",
    }));
    const courseActions = {
      get_store: () => store,
      set: jest.fn(),
      set_activity: jest.fn(() => "activity-id"),
      student_projects: {
        get_student_project_rootfs: getStudentProjectRootfs,
      },
    };
    const actions = new SharedProjectActions(courseActions as any);
    jest.spyOn(actions, "configure").mockResolvedValue();

    await actions.create();

    expect(getStudentProjectRootfs).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        rootfs_image: "cocalc.local/rootfs/course-image",
        rootfs_image_id: "course-image-id",
      }),
    );
  });
});
