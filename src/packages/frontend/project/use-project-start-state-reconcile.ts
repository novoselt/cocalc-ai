/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { useEffect } from "react";
import { redux } from "@cocalc/frontend/app-framework";
import { webapp_client } from "@cocalc/frontend/webapp-client";

const POLL_MS = 4_000;

type ProjectStartReconcileActions = {
  reconcile_project_start_state?: (project_id: string) => Promise<unknown>;
};

export function useProjectStartStateReconcile({
  project_id,
  enabled,
}: {
  project_id: string;
  enabled: boolean;
}): void {
  useEffect(() => {
    if (!enabled || !project_id) {
      return;
    }
    let closed = false;
    let inFlight = false;
    const reconcile = async () => {
      if (
        closed ||
        inFlight ||
        (typeof document !== "undefined" &&
          document.visibilityState !== "visible")
      ) {
        return;
      }
      const actions = redux.getActions(
        "projects",
      ) as ProjectStartReconcileActions;
      if (typeof actions?.reconcile_project_start_state !== "function") {
        return;
      }
      inFlight = true;
      try {
        await actions.reconcile_project_start_state(project_id);
      } catch {
        // The next interval or reconnect retries this best-effort fallback.
      } finally {
        inFlight = false;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void reconcile();
      }
    };
    const handleReconnect = () => void reconcile();

    void reconcile();
    const timer = window.setInterval(() => void reconcile(), POLL_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    webapp_client.conat_client.on?.("connected", handleReconnect);
    return () => {
      closed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      webapp_client.conat_client.removeListener?.("connected", handleReconnect);
    };
  }, [enabled, project_id]);
}
