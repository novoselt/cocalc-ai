/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getPrivateProjectAppOpenUrl } from "./app-server-open";

export async function handoffToPrivateProjectApp({
  appId,
  navigate = (url) => window.location.assign(url),
  projectId,
}: {
  appId: string;
  navigate?: (url: string) => void;
  projectId: string;
}): Promise<void> {
  const url = await getPrivateProjectAppOpenUrl({
    app_id: appId,
    project_id: projectId,
  });
  navigate(url);
}
