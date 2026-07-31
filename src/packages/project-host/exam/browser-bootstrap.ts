/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ExamBrowserSession } from "./controller";

export interface ExamBrowserBootstrap {
  account: {
    account_id: string;
    first_name: string;
    last_name: string;
    display_name: string;
    editor_settings: Record<string, unknown>;
    other_settings: Record<string, unknown>;
    groups: string[];
    terminal: Record<string, unknown>;
    ephemeral: number;
  };
  project: {
    project_id: string;
    title: string;
    description: string;
    users: Record<string, { group: string }>;
    state: { state: string };
    image?: string;
    run_quota?: Record<string, unknown>;
    course?: Record<string, unknown>;
    local_only: true;
    exam_mode: true;
    exam_run_id: string;
  };
}

export function buildExamBrowserBootstrap({
  session,
  account,
  project,
}: {
  session: ExamBrowserSession;
  account?: Record<string, any>;
  project?: Record<string, any>;
}): ExamBrowserBootstrap {
  const projectState =
    typeof project?.state === "string"
      ? project.state
      : typeof project?.state?.state === "string"
        ? project.state.state
        : "running";
  return {
    account: {
      account_id: session.account_id,
      first_name: account?.first_name ?? "Exam",
      last_name: account?.last_name ?? "User",
      display_name: account?.display_name ?? "Exam User",
      editor_settings: account?.editor_settings ?? {},
      other_settings: account?.other_settings ?? {},
      groups: [],
      terminal: {},
      ephemeral: session.expires_at_ms,
    },
    project: {
      project_id: session.project_id,
      title: project?.title ?? "Exam Scratchpad",
      description: project?.description ?? "",
      users: {
        [session.account_id]: { group: "owner" },
      },
      state: { state: projectState },
      ...(typeof project?.image === "string" ? { image: project.image } : {}),
      ...(project?.run_quota != null ? { run_quota: project.run_quota } : {}),
      ...(project?.course != null ? { course: project.course } : {}),
      local_only: true,
      exam_mode: true,
      exam_run_id: session.run_id,
    },
  };
}
