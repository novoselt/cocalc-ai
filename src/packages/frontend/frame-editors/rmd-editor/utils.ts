/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { join } from "path";
import { Set } from "immutable";
import { change_filename_extension, path_split } from "@cocalc/util/misc";
import type { ExecuteCodeOutputAsync } from "@cocalc/util/types/execute-code";

// something in the rmarkdown source code replaces all spaces by dashes
// [hsy] I think this is because of calling pandoc.
// I'm not aware of any other replacements.
// https://github.com/rstudio/rmarkdown
// problem: do not do this for the directory name, only the filename -- issue #4405
export function derive_rmd_output_filename(path, ext) {
  const { head, tail } = path_split(path);
  const fn = change_filename_extension(tail, ext).replace(/ /g, "-");
  // avoid a leading / if it's just a filename (i.e. head = '')
  return join(head, fn);
}

export async function checkProducedFiles(codeEditorActions) {
  const project_actions = codeEditorActions.redux.getProjectActions(
    codeEditorActions.project_id,
  );
  if (project_actions == null) {
    return;
  }

  let existing = Set();
  const fs = codeEditorActions.fs();
  const f = async (ext: string) => {
    const expectedFilename = derive_rmd_output_filename(
      codeEditorActions.path,
      ext,
    );
    if (await fs.exists(expectedFilename)) {
      existing = existing.add(ext);
    }
  };
  const v = ["pdf", "html", "nb.html"].map(f);
  await Promise.all(v);

  // console.log("setting derived_file_types to", existing.toJS());
  codeEditorActions.setState({
    derived_file_types: existing as any,
  });
}

export function getResourceUsage(
  stats: ExecuteCodeOutputAsync["stats"] | undefined,
  type: "peak" | "last",
): string {
  if (!Array.isArray(stats) || stats.length === 0) {
    return "";
  }

  switch (type) {
    // This is after the job finished. We return the CPU time used and max memory.
    case "peak": {
      const max_mem = stats.reduce((cur, val) => {
        return val.mem_rss > cur ? val.mem_rss : cur;
      }, 0);
      // if there is no data (too many processes, etc.) then it is 0.
      //  That information is misleading and we ignore it
      if (max_mem > 0) {
        return ` Peak memory usage: ${max_mem.toFixed(0)} MB.`;
      }
      break;
    }

    // This is while the log updates come in: last known CPU in % and memory usage.
    case "last": {
      const lastStat = stats.slice(-1)[0];
      if (!lastStat) break;

      const { mem_rss, cpu_pct } = lastStat;
      const mem_part =
        typeof mem_rss === "number" &&
        mem_rss > 0 &&
        !isNaN(mem_rss) &&
        isFinite(mem_rss)
          ? `${mem_rss.toFixed(0)} MB memory`
          : "";
      const cpu_part =
        typeof cpu_pct === "number" &&
        cpu_pct >= 0 &&
        cpu_pct <= 100 &&
        !isNaN(cpu_pct) &&
        isFinite(cpu_pct)
          ? `${cpu_pct.toFixed(0)}% CPU`
          : "";
      const parts = [mem_part, cpu_part].filter((p) => p.length > 0);
      if (parts.length > 0) {
        return ` Resource usage: ${parts.join(" and ")}.`;
      }
      break;
    }
    default:
      return "";
  }
  return "";
}
