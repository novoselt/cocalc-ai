/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { alert_message } from "@cocalc/frontend/alerts";
import {
  type AppRedux,
  type Store,
  redux_name,
} from "@cocalc/frontend/app-framework";
import { syncdb2 as new_syncdb } from "@cocalc/frontend/frame-editors/generic/client";

import { type StopwatchEditorState, TimeActions } from "./actions";
export { default } from "./editor";

export function initialize(
  path: string,
  redux: AppRedux,
  project_id: string | undefined,
): string {
  if (project_id == null) {
    throw new Error("a project is required to open a stopwatch");
  }
  const name = redux_name(project_id, path);
  if (redux.getActions(name) !== undefined) {
    return name;
  }

  const store: Store<StopwatchEditorState> =
    redux.createStore<StopwatchEditorState>(name);
  const actions = redux.createActions(name, TimeActions);
  actions._init(project_id, path);

  const syncdb = new_syncdb({
    project_id,
    path,
    primary_keys: ["id"],
    string_cols: ["label"],
  });
  actions.syncdb = syncdb;
  actions.store = store;
  syncdb.once("error", (err) => {
    const message = `Stopwatch error '${path}' -- ${err}`;
    alert_message({ type: "error", message });
  });
  syncdb.on("change", actions._syncdb_change);
  return name;
}

export function remove(
  path: string,
  redux: AppRedux,
  project_id: string | undefined,
): string {
  if (project_id == null) {
    throw new Error("a project is required to close a stopwatch");
  }
  const name = redux_name(project_id, path);
  const actions: InstanceType<typeof TimeActions> = redux.getActions(name);
  if (actions !== undefined && actions.syncdb !== undefined) {
    actions.syncdb.close();
  }
  const store: Store<StopwatchEditorState> | undefined =
    redux.getStore<StopwatchEditorState>(name);
  if (store == undefined) {
    return name;
  }
  // This order is critical: unmount the store before the actions to avoid a
  // retained listener graph.
  redux.removeStore(name);
  redux.removeActions(name);
  return name;
}
