/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fromJS, Map } from "immutable";
import { applyAccountPatch } from "@cocalc/frontend/account/table";
import { webapp_client } from "@cocalc/frontend/webapp-client";

export interface ExamSessionBootstrap {
  account: Record<string, any> & { account_id: string };
  project: Record<string, any> & { project_id: string };
}

export function applyExamSessionBootstrap({
  redux,
  session,
}: {
  redux: any;
  session?: ExamSessionBootstrap;
}): void {
  if (!session) return;
  // Parent-domain CoCalc cookies are also visible on exam subdomains. The
  // authenticated host-local exam session is authoritative here; replace any
  // normal-site account id before Conat and account persistence initialize.
  webapp_client.account_id = session.account.account_id;
  const accountStore = redux.getStore("account");
  applyAccountPatch({
    redux,
    patch: {
      ...session.account,
      user_type: "signed_in",
      is_logged_in: true,
      is_admin: false,
    },
    first_set: !accountStore?.get("is_ready"),
  });

  const projectsStore = redux.getStore("projects");
  const current = projectsStore?.get("project_map") ?? Map<string, any>();
  redux.getActions("projects").setState({
    project_map: current.set(
      session.project.project_id,
      fromJS(session.project),
    ),
  });
}
