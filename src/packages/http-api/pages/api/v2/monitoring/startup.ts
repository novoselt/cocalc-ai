/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import getAccountId from "@cocalc/http-api/lib/account/get-account";
import isPost from "@cocalc/http-api/lib/api/is-post";
import { getServerSettings } from "@cocalc/database/settings/server-settings";
import { getRememberMeHash } from "@cocalc/server/auth/remember-me";
import { recordUxLatencyEvent } from "@cocalc/server/monitoring/ux-latency";
import { to_bool } from "@cocalc/util/db-schema/site-defaults";

const ALLOWED_METRICS = new Set([
  "signed_in_app_abandoned_v1",
  "signed_in_app_incomplete_v1",
]);

export default async function recordStartupDiagnostic(req, res) {
  if (!isPost(req, res)) return;
  if (req.header("Authorization")) {
    res.json({ error: "API keys are not allowed to record browser startup" });
    return;
  }

  try {
    const settings = await getServerSettings();
    if (!to_bool(settings.ux_latency_telemetry_enabled)) {
      res.status(204).end();
      return;
    }
    if (!getRememberMeHash(req)) {
      res.status(204).end();
      return;
    }
    const account_id = await getAccountId(req);
    const metric = `${req.body?.metric ?? ""}`;
    if (!account_id || !ALLOWED_METRICS.has(metric)) {
      res.status(204).end();
      return;
    }
    await recordUxLatencyEvent({
      account_id,
      event: {
        event_type: "app_bootstrap",
        metric,
        duration_ms: req.body?.duration_ms,
        client_event_id: req.body?.client_event_id,
        started_at: req.body?.started_at,
        sample_rate: 1,
        segment: req.body?.segment,
        details: req.body?.details,
      },
    });
  } catch {
    // Startup diagnostics are best effort and must not create UI errors.
  }
  res.status(204).end();
}
