/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { onSignedInSurfaceReady } from "@cocalc/frontend/app/surface-ready-state";

let initialization: Promise<void> | undefined;

export function ensureJqueryPluginsInitialized(): Promise<void> {
  initialization ??= import("./index")
    .then(async ({ init }) => {
      init();
      await Promise.all([
        import("jquery-tooltip/jquery.tooltip"),
        import("timeago"),
        import("jquery.scrollintoview/jquery.scrollintoview"),
      ]);
    })
    .catch((err) => {
      initialization = undefined;
      throw err;
    });
  return initialization;
}

export function installPostSurfaceJqueryPlugins(): () => void {
  return onSignedInSurfaceReady(() => {
    void ensureJqueryPluginsInitialized().catch(() => {});
  });
}
