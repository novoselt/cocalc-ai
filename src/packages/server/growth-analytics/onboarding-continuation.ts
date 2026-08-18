/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import getPool from "@cocalc/database/pool";
import { createNotificationEventGraph } from "@cocalc/database/postgres/notifications-core";
import { getConfiguredBayId } from "@cocalc/server/bay-config";

const logger = getLogger("server:growth-analytics:onboarding-continuation");
const DEFAULT_DELAY_HOURS = 20;
const DEFAULT_BATCH_SIZE = 100;
const PROCESSING_LEASE_MINUTES = 15;
const MAX_ATTEMPTS = 10;

type ContinuationRow = {
  account_id: string;
  home_bay_id: string;
  project_id: string;
  onboarding_path: string;
  notification_event_id: string;
  notification_id: string;
  attempt_count: number;
};

type EligibilityRow = {
  account_exists: boolean;
  banned: boolean;
  project_exists: boolean;
  project_access: boolean;
  returned: boolean;
};

export interface OnboardingContinuationResult {
  scheduled: number;
  claimed: number;
  sent: number;
  suppressed: number;
  failed: number;
}

function delayHours(): number {
  const value = Number(process.env.COCALC_ONBOARDING_CONTINUATION_DELAY_HOURS);
  return Number.isFinite(value) && value >= 1
    ? Math.min(value, 168)
    : DEFAULT_DELAY_HOURS;
}

function batchSize(): number {
  const value = Number(process.env.COCALC_ONBOARDING_CONTINUATION_BATCH_SIZE);
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, 1_000)
    : DEFAULT_BATCH_SIZE;
}

export function continuationArtifact(
  onboardingPath: string,
): string | undefined {
  switch (onboardingPath) {
    case "jupyter-python":
    case "jupyter-r":
    case "jupyter-julia":
    case "sage":
      return "Welcome.ipynb";
    case "code":
      return "Terminal.term";
    case "latex":
      return "document.tex";
    case "teaching":
      return "Course.course";
    default:
      return undefined;
  }
}

function continuationCopy(onboardingPath: string): {
  title: string;
  body: string;
} {
  switch (onboardingPath) {
    case "jupyter-python":
    case "jupyter-r":
    case "jupyter-julia":
    case "sage":
      return {
        title: "Continue your first CoCalc notebook",
        body: "Your notebook and software environment are saved and ready. Reopen the notebook to continue where you left off.",
      };
    case "latex":
      return {
        title: "Continue your first CoCalc document",
        body: "Your LaTeX project and document are saved and ready. Reopen the document to continue where you left off.",
      };
    case "code":
      return {
        title: "Continue your first CoCalc project",
        body: "Your Linux project is saved and ready. Reopen its terminal to continue where you left off.",
      };
    case "teaching":
      return {
        title: "Continue setting up your CoCalc course",
        body: "Your course project is saved and ready. Reopen it to continue configuring the course.",
      };
    default:
      return {
        title: "Continue your first CoCalc project",
        body: "Your project is saved and ready. Reopen it to continue where you left off.",
      };
  }
}

function continuationTarget(projectId: string, onboardingPath: string): string {
  const artifact = continuationArtifact(onboardingPath);
  return artifact
    ? `/projects/${projectId}/files/${encodeURIComponent(artifact)}`
    : `/projects/${projectId}/files/`;
}

async function scheduleEligibleContinuations(): Promise<number> {
  const result = await getPool().query(
    `INSERT INTO growth_onboarding_continuations (
       account_id, home_bay_id, project_id, onboarding_path, source_event_id,
       notification_event_id, notification_id, eligible_at, status,
       attempt_count, created_at, updated_at
     )
     SELECT DISTINCT ON (event.account_id)
       event.account_id,
       profile.home_bay_id,
       event.project_id,
       event.properties->>'onboarding_path',
       event.event_id,
       gen_random_uuid(),
       gen_random_uuid(),
       GREATEST(
         profile.account_created_at + ($2::DOUBLE PRECISION * INTERVAL '1 hour'),
         event.occurred_at + INTERVAL '12 hours'
       ),
       'pending', 0, NOW(), NOW()
     FROM growth_event_log AS event
     JOIN growth_account_profiles AS profile USING (account_id)
     WHERE event.home_bay_id=$1
       AND profile.home_bay_id=$1
       AND profile.excluded_from_growth IS NOT TRUE
       AND profile.account_created_at >= NOW() - INTERVAL '3 days'
       AND event.event_name='project_ready'
       AND event.project_id IS NOT NULL
       AND NULLIF(event.properties->>'onboarding_path', '') IS NOT NULL
     ORDER BY event.account_id, event.occurred_at ASC, event.event_id
     ON CONFLICT (account_id) DO NOTHING`,
    [getConfiguredBayId(), delayHours()],
  );
  return result.rowCount ?? 0;
}

async function claimDueContinuations(): Promise<ContinuationRow[]> {
  const { rows } = await getPool().query<ContinuationRow>(
    `WITH reset AS (
       UPDATE growth_onboarding_continuations
          SET status='pending', updated_at=NOW(),
              last_error=COALESCE(last_error, 'processing lease expired')
        WHERE status='processing'
          AND updated_at < NOW() - ($2::TEXT || ' minutes')::INTERVAL
     ), due AS (
       SELECT account_id
         FROM growth_onboarding_continuations
        WHERE home_bay_id=$1
          AND status='pending'
          AND eligible_at <= NOW()
          AND attempt_count < $3
        ORDER BY eligible_at, account_id
        LIMIT $4
        FOR UPDATE SKIP LOCKED
     )
     UPDATE growth_onboarding_continuations AS continuation
        SET status='processing', attempt_count=attempt_count+1, updated_at=NOW()
       FROM due
      WHERE continuation.account_id=due.account_id
     RETURNING continuation.account_id, continuation.home_bay_id,
               continuation.project_id, continuation.onboarding_path,
               continuation.notification_event_id,
               continuation.notification_id, continuation.attempt_count`,
    [getConfiguredBayId(), PROCESSING_LEASE_MINUTES, MAX_ATTEMPTS, batchSize()],
  );
  return rows;
}

async function eligibility(row: ContinuationRow): Promise<EligibilityRow> {
  const { rows } = await getPool().query<EligibilityRow>(
    `SELECT
       account.account_id IS NOT NULL AS account_exists,
       COALESCE(account.banned, FALSE) AS banned,
       project.project_id IS NOT NULL AND project.deleted IS NOT TRUE
         AS project_exists,
       project.users ? $1::TEXT AS project_access,
       EXISTS (
         SELECT 1
           FROM growth_account_activity_daily AS activity
           JOIN growth_account_profiles AS profile
             ON profile.account_id=activity.account_id
          WHERE activity.account_id=$1
            AND activity.project_work
            AND activity.last_activity_at >=
                profile.account_created_at + INTERVAL '12 hours'
       ) AS returned
      FROM (SELECT 1) AS singleton
      LEFT JOIN accounts AS account
        ON account.account_id=$1 AND COALESCE(account.deleted, FALSE) IS NOT TRUE
      LEFT JOIN projects AS project ON project.project_id=$2`,
    [row.account_id, row.project_id],
  );
  return (
    rows[0] ?? {
      account_exists: false,
      banned: false,
      project_exists: false,
      project_access: false,
      returned: false,
    }
  );
}

function suppressionReason(value: EligibilityRow): string | undefined {
  if (!value.account_exists) return "account-deleted";
  if (value.banned) return "account-banned";
  if (!value.project_exists) return "project-deleted";
  if (!value.project_access) return "project-access-removed";
  if (value.returned) return "already-returned";
  return undefined;
}

async function markSuppressed(
  accountId: string,
  reason: string,
): Promise<void> {
  await getPool().query(
    `UPDATE growth_onboarding_continuations
        SET status='suppressed', suppressed_at=NOW(), suppression_reason=$2,
            updated_at=NOW()
      WHERE account_id=$1`,
    [accountId, reason],
  );
}

async function notificationAlreadyExists(eventId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `SELECT 1 FROM notification_events WHERE event_id=$1 LIMIT 1`,
    [eventId],
  );
  return !!rowCount;
}

async function emitContinuation(row: ContinuationRow): Promise<void> {
  if (!(await notificationAlreadyExists(row.notification_event_id))) {
    const copy = continuationCopy(row.onboarding_path);
    const actionLink = continuationTarget(row.project_id, row.onboarding_path);
    const artifact = continuationArtifact(row.onboarding_path);
    const sourcePath = artifact ? `/home/user/${artifact}` : "/home/user";
    const noticeType = "onboarding_day_one";
    await createNotificationEventGraph({
      event_id: row.notification_event_id,
      kind: "account_notice",
      source_bay_id: row.home_bay_id,
      source_project_id: row.project_id,
      source_path: sourcePath,
      actor_account_id: null,
      origin_kind: "system",
      payload_json: {
        severity: "info",
        title: copy.title,
        body_markdown: copy.body,
        origin_label: "CoCalc",
        action_link: actionLink,
        action_label: "Continue project",
        notice_type: noticeType,
      },
      targets: [
        {
          target_account_id: row.account_id,
          target_home_bay_id: row.home_bay_id,
          notification_id: row.notification_id,
          dedupe_key: `onboarding-day-one:${row.account_id}`,
          summary_json: {
            title: copy.title,
            body_markdown: copy.body,
            severity: "info",
            origin_label: "CoCalc",
            action_link: actionLink,
            action_label: "Continue project",
            notice_type: noticeType,
            path: sourcePath,
            display_path: artifact ?? ".",
          },
        },
      ],
    });
  }
  await getPool().query(
    `UPDATE growth_onboarding_continuations
        SET status='sent', sent_at=COALESCE(sent_at, NOW()), last_error=NULL,
            updated_at=NOW()
      WHERE account_id=$1`,
    [row.account_id],
  );
}

async function markFailure(row: ContinuationRow, err: unknown): Promise<void> {
  const terminal = row.attempt_count >= MAX_ATTEMPTS;
  await getPool().query(
    `UPDATE growth_onboarding_continuations
        SET status=$2, last_error=$3, updated_at=NOW()
      WHERE account_id=$1`,
    [
      row.account_id,
      terminal ? "failed" : "pending",
      `${err instanceof Error ? err.message : err}`.slice(0, 2_000),
    ],
  );
}

export async function runOnboardingContinuationOnce(): Promise<OnboardingContinuationResult> {
  const result: OnboardingContinuationResult = {
    scheduled: await scheduleEligibleContinuations(),
    claimed: 0,
    sent: 0,
    suppressed: 0,
    failed: 0,
  };
  const rows = await claimDueContinuations();
  result.claimed = rows.length;
  for (const row of rows) {
    try {
      const reason = suppressionReason(await eligibility(row));
      if (reason) {
        await markSuppressed(row.account_id, reason);
        result.suppressed += 1;
        continue;
      }
      await emitContinuation(row);
      result.sent += 1;
    } catch (err) {
      await markFailure(row, err);
      result.failed += 1;
      logger.warn("failed to deliver onboarding continuation", {
        account_id: row.account_id,
        project_id: row.project_id,
        err: `${err}`,
      });
    }
  }
  return result;
}

export const __test__ = {
  continuationCopy,
  continuationTarget,
  emitContinuation,
  suppressionReason,
};
