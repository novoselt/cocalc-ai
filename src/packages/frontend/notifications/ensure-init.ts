/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { redux } from "@cocalc/frontend/app-framework";

let initializing: Promise<void> | undefined;

export async function ensureNotificationsInitialized(): Promise<void> {
  if (redux.getStore("mentions") != null && redux.getStore("news") != null) {
    return;
  }
  if (initializing == null) {
    initializing = Promise.all([import("./init"), import("./news/init")]).then(
      ([notifications, news]) => {
        notifications.init(redux);
        news.init();
      },
    );
  }
  try {
    await initializing;
  } catch (err) {
    initializing = undefined;
    throw err;
  }
}
