/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ProjectState } from "@cocalc/util/db-schema/projects";

type ProjectStateReporter = (
  project_id: string,
  state: ProjectState | string,
) => Promise<void>;

let reporter: ProjectStateReporter | undefined;

export function setProjectStateReporter(next: ProjectStateReporter): void {
  reporter = next;
}

export async function reportProjectStateImmediately(
  project_id: string,
  state: ProjectState | string,
): Promise<void> {
  await reporter?.(project_id, state);
}
