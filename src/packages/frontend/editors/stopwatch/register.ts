/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Register the time editor -- stopwatch
  - set the file extension, icon, react component,
    and how to init and remove the actions/store
*/

import { loadWithRetry } from "@cocalc/frontend/app/lazy-with-retry";
import { type AppRedux, redux_name } from "@cocalc/frontend/app-framework";
import { register_file_editor } from "@cocalc/frontend/project-file";
import { reuseInFlight } from "@cocalc/util/reuse-in-flight";

type StopwatchRuntime = typeof import("./runtime");

let runtime: StopwatchRuntime | undefined;
const loadRuntime = reuseInFlight(async (): Promise<StopwatchRuntime> => {
  runtime ??= await loadWithRetry(() => import("./runtime"), {
    name: "stopwatch editor",
  });
  return runtime;
});

register_file_editor({
  ext: ["time"],

  icon: "stopwatch",

  componentAsync: async () => (await loadRuntime()).default,

  async initAsync(
    path: string,
    redux: AppRedux,
    project_id: string | undefined,
  ): Promise<string> {
    return (await loadRuntime()).initialize(path, redux, project_id);
  },

  remove(
    path: string,
    redux: AppRedux,
    project_id: string | undefined,
  ): string {
    if (runtime != null) {
      return runtime.remove(path, redux, project_id);
    }
    if (project_id == null) {
      throw new Error("a project is required to close a stopwatch");
    }
    const name = redux_name(project_id, path);
    return name;
  },
});
