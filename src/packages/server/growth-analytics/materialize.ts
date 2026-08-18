/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import { getPoolClient, type PoolClient } from "@cocalc/database/pool";

import { GROWTH_METRIC_VERSION } from "@cocalc/conat/hub/api/growth-analytics";
import { getConfiguredBayId } from "@cocalc/server/bay-config";

const logger = getLogger("server:growth-analytics:materialize");
const WORKER_NAME = "growth-materializer-v1";
const LOCK_NAME = "growth-analytics-materializer-v1";
const DEFAULT_BATCH_SIZE = 2_000;
const RETENTION_DAYS = 90;

type Watermark = { received_at?: string; event_id?: string };
type EventCursorRow = { event_id: string; received_at: string };

function batchSize(): number {
  const value = Number(process.env.COCALC_GROWTH_MATERIALIZER_BATCH_SIZE);
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, 20_000)
    : DEFAULT_BATCH_SIZE;
}

function parseWatermark(value: unknown): Watermark {
  if (value == null || typeof value !== "object") return {};
  const data = value as Record<string, unknown>;
  return {
    received_at:
      typeof data.received_at === "string" ? data.received_at : undefined,
    event_id: typeof data.event_id === "string" ? data.event_id : undefined,
  };
}

export function activityFlagsForEvent(eventName: string): {
  app_foreground: boolean;
  project_engaged: boolean;
  project_work: boolean;
  self_directed_work: boolean;
  ai_engaged: boolean;
} {
  const projectWork =
    eventName === "project_work" ||
    eventName === "ai_prompt_submitted" ||
    eventName === "first_self_directed_work";
  return {
    app_foreground:
      projectWork ||
      eventName === "app_foreground" ||
      eventName === "project_engaged",
    project_engaged: projectWork || eventName === "project_engaged",
    project_work: projectWork,
    self_directed_work: eventName === "first_self_directed_work",
    ai_engaged: eventName === "ai_prompt_submitted",
  };
}

async function ensureState(client: PoolClient, scopeId: string): Promise<void> {
  await client.query(
    `INSERT INTO growth_materialization_state
       (worker_name, scope_id, source_watermark, metric_definition_version,
        coverage_started_at, updated_at)
     VALUES ($1, $2, '{}'::jsonb, $3, NOW(), NOW())
     ON CONFLICT (worker_name, scope_id) DO NOTHING`,
    [WORKER_NAME, scopeId, GROWTH_METRIC_VERSION],
  );
}

async function backfillProfiles(
  client: PoolClient,
  scopeId: string,
  coverageStartedAt: Date,
): Promise<number> {
  const result = await client.query(
    `WITH account_candidates AS MATERIALIZED (
       SELECT a.account_id, a.home_bay_id, a.created, a.email_address,
              a.email_address_verified, a.password_hash, a.ephemeral,
              a.banned, a.groups, a.tags
         FROM accounts AS a
        WHERE COALESCE(a.home_bay_id, $1) = $1
          AND NOT EXISTS (
            SELECT 1 FROM growth_account_profiles AS profile
             WHERE profile.account_id = a.account_id
          )
        ORDER BY a.created DESC, a.account_id
        LIMIT $2
     ), candidates AS (
       SELECT a.*, attribution.data AS attribution,
              growth_auth.auth_method AS growth_auth_method
         FROM account_candidates AS a
         LEFT JOIN LATERAL (
           SELECT data
             FROM analytics
            WHERE account_id = a.account_id
            ORDER BY data_time ASC NULLS LAST
            LIMIT 1
         ) AS attribution ON TRUE
         LEFT JOIN LATERAL (
           SELECT NULLIF(properties->>'auth_method', '') AS auth_method
             FROM growth_event_log
            WHERE account_id=a.account_id
              AND event_name IN ('account_created', 'identity_proved')
            ORDER BY occurred_at DESC
            LIMIT 1
         ) AS growth_auth ON TRUE
     ), inserted AS (
       INSERT INTO growth_account_profiles (
         account_id, home_bay_id, account_created_at, cohort_date, cohort_week,
         verified_at, auth_method, acquisition_channel, landing_group, campaign,
         legacy_status, institution_class, actor_class, onboarding_eligibility,
         codex_entitlement_at_creation, excluded_from_growth, exclusion_reason,
         definition_version, source_confidence
       )
       SELECT
         account_id,
         COALESCE(home_bay_id, $1),
         created AT TIME ZONE 'UTC',
         (created AT TIME ZONE 'UTC')::date,
         date_trunc('week', created AT TIME ZONE 'UTC')::date,
         CASE
           WHEN email_address_verified ? email_address
           THEN CASE
             WHEN COALESCE(email_address_verified ->> email_address, '')
                    ~ '^\\d{4}-\\d{2}-\\d{2}'
             THEN (email_address_verified ->> email_address)::timestamptz
             ELSE created AT TIME ZONE 'UTC'
           END
           ELSE NULL
         END,
         COALESCE(
           growth_auth_method,
           CASE
             WHEN password_hash IS NOT NULL THEN 'password'
             WHEN email_address_verified ? email_address THEN 'verified_existing'
             ELSE 'unknown'
           END
         ),
         CASE
           WHEN COALESCE(attribution #>> '{utm,source}', '') <> '' THEN 'paid_campaign'
           WHEN COALESCE(attribution->>'referrer', '') ~* 'google\\.' THEN 'google_organic'
           WHEN COALESCE(attribution->>'referrer', '') ~* '(bing\\.|duckduckgo\\.|yahoo\\.)' THEN 'other_organic'
           WHEN COALESCE(attribution->>'referrer', '') ~* '(sagemath|sagecell)' THEN 'sagemath_properties'
           WHEN COALESCE(attribution->>'referrer', '') ~* '(chatgpt|openai|perplexity|claude\\.ai|gemini)' THEN 'ai_assistant_referral'
           WHEN COALESCE(attribution->>'referrer', '') <> '' THEN 'other_referral'
           ELSE 'direct_unknown'
         END,
         CASE
           WHEN COALESCE(attribution->>'landing', '') ~ '/features/jupyter' THEN 'jupyter'
           WHEN COALESCE(attribution->>'landing', '') ~ '/features/sage' THEN 'sage'
           WHEN COALESCE(attribution->>'landing', '') ~ '/features/latex' THEN 'latex'
           WHEN COALESCE(attribution->>'landing', '') ~ '/features/' THEN 'feature'
           WHEN COALESCE(attribution->>'landing', '') ~ '/pricing' THEN 'pricing'
           WHEN COALESCE(attribution->>'landing', '') ~ '/share/' THEN 'public_share'
           WHEN COALESCE(attribution->>'landing', '') ~ '/auth/' THEN 'signup'
           WHEN COALESCE(attribution->>'landing', '') ~ '^https?://[^/]+/?$' THEN 'homepage'
           ELSE 'other'
         END,
         NULLIF(LEFT(COALESCE(attribution #>> '{utm,campaign}', ''), 96), ''),
         CASE WHEN created >= $4::timestamptz THEN 'new' ELSE 'legacy' END,
         CASE
           WHEN email_address ~* '@[^@]+\\.(edu|ac\\.[a-z]{2}|edu\\.[a-z]{2})$' THEN 'academic'
           ELSE 'unknown'
         END,
         CASE
           WHEN ephemeral IS NOT NULL THEN 'ephemeral'
           WHEN COALESCE(groups, ARRAY[]::text[]) && ARRAY['admin']::text[] THEN 'staff'
           WHEN COALESCE(tags, ARRAY[]::text[]) && ARRAY['test']::text[] THEN 'test'
           ELSE 'customer'
         END,
         CASE WHEN created >= $4::timestamptz THEN 'new' ELSE 'legacy' END,
         'site_funded_unknown',
         CASE
           WHEN ephemeral IS NOT NULL OR COALESCE(banned, FALSE)
             OR COALESCE(groups, ARRAY[]::text[]) && ARRAY['admin']::text[]
             OR COALESCE(tags, ARRAY[]::text[]) && ARRAY['test']::text[]
           THEN TRUE ELSE FALSE
         END,
         CASE
           WHEN ephemeral IS NOT NULL THEN 'ephemeral'
           WHEN COALESCE(banned, FALSE) THEN 'banned'
           WHEN COALESCE(groups, ARRAY[]::text[]) && ARRAY['admin']::text[] THEN 'staff'
           WHEN COALESCE(tags, ARRAY[]::text[]) && ARRAY['test']::text[] THEN 'test'
           ELSE NULL
         END,
         $3,
         'server_backfill'
       FROM candidates
       ON CONFLICT (account_id) DO NOTHING
       RETURNING account_id, home_bay_id, account_created_at, cohort_date, cohort_week,
                 verified_at
     ), milestones AS (
       INSERT INTO growth_account_milestones
         (account_id, milestone, definition_version, occurred_at,
          home_bay_id, metadata_class)
       SELECT account_id, 'account_created', $3, account_created_at,
              home_bay_id, 'server_backfill'
         FROM inserted
       ON CONFLICT (account_id, milestone, definition_version) DO NOTHING
       RETURNING account_id
     ), verified AS (
       INSERT INTO growth_account_milestones
         (account_id, milestone, definition_version, occurred_at,
          home_bay_id, metadata_class)
       SELECT account_id, 'identity_proved', $3, verified_at,
              home_bay_id, 'server_backfill'
         FROM inserted
        WHERE verified_at IS NOT NULL
       ON CONFLICT (account_id, milestone, definition_version) DO NOTHING
       RETURNING account_id
     )
     INSERT INTO growth_dirty_periods
       (metric_version, scope_id, period_grain, period_start, reason)
     SELECT $3, $1, dirty.grain, dirty.period_start, 'profile_backfill'
       FROM (
         SELECT grain, period_start
           FROM inserted
           CROSS JOIN LATERAL (
             VALUES ('calendar_day', cohort_date), ('cohort_day', cohort_date),
                    ('cohort_week', cohort_week)
           ) AS profile_dirty(grain, period_start)
          WHERE inserted.account_created_at >= $4::timestamptz
         UNION
         SELECT 'calendar_day', (event.occurred_at AT TIME ZONE 'UTC')::date
           FROM growth_event_log AS event
           JOIN inserted USING (account_id)
         UNION
         SELECT 'calendar_week',
                date_trunc('week', event.occurred_at AT TIME ZONE 'UTC')::date
           FROM growth_event_log AS event
           JOIN inserted USING (account_id)
       ) AS dirty(grain, period_start)
     ON CONFLICT (metric_version, scope_id, period_grain, period_start)
     DO UPDATE SET reason=EXCLUDED.reason, updated_at=NOW()`,
    [scopeId, batchSize(), GROWTH_METRIC_VERSION, coverageStartedAt],
  );
  return result.rowCount ?? 0;
}

// Cohort attributes are snapshots, but administrative exclusions remain mutable.
async function reconcileProfileExclusions(
  client: PoolClient,
  scopeId: string,
): Promise<number> {
  const { rows } = await client.query<{ changed: number }>(
    `WITH candidate_ids AS MATERIALIZED (
       SELECT account_id FROM accounts WHERE banned IS TRUE
       UNION
       SELECT account_id FROM growth_account_profiles
        WHERE home_bay_id=$1 AND exclusion_reason='banned'
     ), desired AS MATERIALIZED (
       SELECT profile.account_id, profile.account_created_at,
              profile.cohort_date, profile.cohort_week,
              profile.legacy_status,
              CASE
                WHEN account.ephemeral IS NOT NULL
                  OR COALESCE(account.banned, FALSE)
                  OR COALESCE(account.groups, ARRAY[]::text[])
                       && ARRAY['admin']::text[]
                  OR COALESCE(account.tags, ARRAY[]::text[])
                       && ARRAY['test']::text[]
                THEN TRUE ELSE FALSE
              END AS excluded_from_growth,
              CASE
                WHEN account.ephemeral IS NOT NULL THEN 'ephemeral'
                WHEN COALESCE(account.banned, FALSE) THEN 'banned'
                WHEN COALESCE(account.groups, ARRAY[]::text[])
                       && ARRAY['admin']::text[] THEN 'staff'
                WHEN COALESCE(account.tags, ARRAY[]::text[])
                       && ARRAY['test']::text[] THEN 'test'
                ELSE NULL
              END AS exclusion_reason
         FROM candidate_ids
         JOIN growth_account_profiles AS profile USING (account_id)
         JOIN accounts AS account USING (account_id)
        WHERE profile.home_bay_id=$1
     ), changed AS MATERIALIZED (
       UPDATE growth_account_profiles AS profile
          SET excluded_from_growth=desired.excluded_from_growth,
              exclusion_reason=desired.exclusion_reason,
              updated_at=NOW()
         FROM desired
        WHERE profile.account_id=desired.account_id
          AND (
            profile.excluded_from_growth IS DISTINCT FROM
              desired.excluded_from_growth
            OR profile.exclusion_reason IS DISTINCT FROM
              desired.exclusion_reason
          )
       RETURNING profile.account_id, profile.account_created_at,
                 profile.cohort_date, profile.cohort_week,
                 profile.legacy_status
     ), dirtied AS (
       INSERT INTO growth_dirty_periods
         (metric_version, scope_id, period_grain, period_start, reason)
       SELECT $2, $1, dirty.grain, dirty.period_start,
              'profile_exclusion_reconciled'
         FROM (
           SELECT 'calendar_day'::text AS grain, cohort_date AS period_start
             FROM changed WHERE legacy_status='new'
           UNION
           SELECT 'cohort_day', cohort_date
             FROM changed WHERE legacy_status='new'
           UNION
           SELECT 'cohort_week', cohort_week
             FROM changed WHERE legacy_status='new'
           UNION
           SELECT 'calendar_day', activity.activity_date
             FROM changed
             JOIN growth_account_activity_daily AS activity USING (account_id)
            WHERE activity.metric_contract_version=$2
           UNION
           SELECT 'calendar_week',
                  date_trunc('week', activity.activity_date::timestamp)::date
             FROM changed
             JOIN growth_account_activity_daily AS activity USING (account_id)
            WHERE activity.metric_contract_version=$2
         ) AS dirty
       ON CONFLICT (metric_version, scope_id, period_grain, period_start)
       DO UPDATE SET reason=EXCLUDED.reason, updated_at=NOW()
       RETURNING 1
     )
     SELECT COUNT(*)::int AS changed FROM changed`,
    [scopeId, GROWTH_METRIC_VERSION],
  );
  return rows[0]?.changed ?? 0;
}

async function selectEventBatch(
  client: PoolClient,
  scopeId: string,
  watermark: Watermark,
): Promise<EventCursorRow[]> {
  const { rows } = await client.query<EventCursorRow>(
    `SELECT event_id, received_at::text AS received_at
       FROM growth_event_log
      WHERE home_bay_id = $1
        AND (
          $2::timestamptz IS NULL
          OR (received_at, event_id) > ($2::timestamptz, $3::uuid)
        )
      ORDER BY received_at, event_id
      LIMIT $4`,
    [
      scopeId,
      watermark.received_at ?? null,
      watermark.event_id ?? "00000000-0000-0000-0000-000000000000",
      batchSize(),
    ],
  );
  return rows;
}

async function materializeEvents(
  client: PoolClient,
  eventIds: string[],
  scopeId: string,
): Promise<void> {
  if (!eventIds.length) return;
  await client.query(
    `WITH account_created AS (
       SELECT DISTINCT ON (account_id) account_id,
              NULLIF(properties->>'auth_method', '') AS auth_method
         FROM growth_event_log
        WHERE event_id=ANY($1::uuid[]) AND event_name='account_created'
        ORDER BY account_id, occurred_at
     ), identity AS (
       SELECT DISTINCT ON (account_id) account_id, occurred_at,
              NULLIF(properties->>'auth_method', '') AS auth_method
         FROM growth_event_log
        WHERE event_id=ANY($1::uuid[]) AND event_name='identity_proved'
        ORDER BY account_id, occurred_at
     )
     UPDATE growth_account_profiles AS profile
        SET verified_at=CASE
              WHEN identity.occurred_at IS NULL THEN profile.verified_at
              WHEN profile.verified_at IS NULL THEN identity.occurred_at
              ELSE LEAST(profile.verified_at, identity.occurred_at)
            END,
            auth_method=COALESCE(
              identity.auth_method, account_created.auth_method,
              NULLIF(profile.auth_method, 'unknown'), 'unknown'
            ),
            updated_at=NOW()
       FROM account_created
       FULL OUTER JOIN identity USING (account_id)
      WHERE profile.account_id=COALESCE(
        account_created.account_id, identity.account_id
      )`,
    [eventIds],
  );
  await client.query(
    `WITH candidates AS (
       SELECT event.account_id,
              CASE
                WHEN event.event_name IN (
                  'identity_proved', 'account_created', 'profile_completed',
                  'first_project_flow_seen', 'onboarding_path_selected',
                  'onboarding_configuration_seen',
                  'onboarding_configuration_ready', 'project_create_started',
                  'project_created', 'project_ready', 'project_entered',
                  'project_surface_visible', 'guided_activation_done',
                  'first_self_directed_work'
                ) THEN event.event_name
                WHEN event.event_name IN ('project_work', 'ai_prompt_submitted')
                  THEN 'first_meaningful_work'
                ELSE NULL
              END AS milestone,
              event.occurred_at, event.event_id, event.home_bay_id,
              NULLIF(event.properties->>'metadata_class', '') AS metadata_class
         FROM growth_event_log AS event
        WHERE event.event_id = ANY($1::uuid[])
          AND event.event_name NOT IN (
            'app_foreground', 'project_engaged', 'guided_activation_abandoned'
          )
     ), earliest AS (
       SELECT DISTINCT ON (account_id, milestone)
              account_id, milestone, occurred_at, event_id, home_bay_id,
              metadata_class
         FROM candidates
        WHERE milestone IS NOT NULL
        ORDER BY account_id, milestone, occurred_at, event_id
     )
     INSERT INTO growth_account_milestones
       (account_id, milestone, definition_version, occurred_at,
        source_event_id, home_bay_id, metadata_class)
     SELECT account_id, milestone, $2, occurred_at, event_id, home_bay_id,
            metadata_class
       FROM earliest
     ON CONFLICT (account_id, milestone, definition_version)
     DO UPDATE SET
       occurred_at=LEAST(growth_account_milestones.occurred_at, EXCLUDED.occurred_at),
       source_event_id=CASE
         WHEN EXCLUDED.occurred_at < growth_account_milestones.occurred_at
         THEN EXCLUDED.source_event_id
         ELSE growth_account_milestones.source_event_id
       END,
       updated_at=NOW()`,
    [eventIds, GROWTH_METRIC_VERSION],
  );
  await client.query(
    `INSERT INTO growth_account_milestones
       (account_id, milestone, definition_version, occurred_at,
        source_event_id, home_bay_id, metadata_class)
     SELECT DISTINCT ON (account_id)
            account_id, 'first_meaningful_work', $2, occurred_at, event_id,
            home_bay_id, 'self_directed'
       FROM growth_event_log
      WHERE event_id=ANY($1::uuid[])
        AND event_name='first_self_directed_work'
      ORDER BY account_id, occurred_at, event_id
     ON CONFLICT (account_id, milestone, definition_version)
     DO UPDATE SET occurred_at=LEAST(
       growth_account_milestones.occurred_at, EXCLUDED.occurred_at
     ), updated_at=NOW()`,
    [eventIds, GROWTH_METRIC_VERSION],
  );
  await client.query(
    `INSERT INTO growth_account_milestones
       (account_id, milestone, definition_version, occurred_at,
        source_event_id, home_bay_id, metadata_class)
     SELECT DISTINCT ON (account_id)
            account_id, 'first_ai_prompt', $2, occurred_at, event_id,
            home_bay_id, 'ai_prompt'
       FROM growth_event_log
      WHERE event_id = ANY($1::uuid[])
        AND event_name = 'ai_prompt_submitted'
      ORDER BY account_id, occurred_at, event_id
     ON CONFLICT (account_id, milestone, definition_version)
     DO UPDATE SET occurred_at=LEAST(
       growth_account_milestones.occurred_at, EXCLUDED.occurred_at
     ), updated_at=NOW()`,
    [eventIds, GROWTH_METRIC_VERSION],
  );
  await client.query(
    `INSERT INTO growth_account_activity_daily (
       account_id, activity_date, metric_contract_version, home_bay_id,
       app_foreground, project_engaged, project_work, self_directed_work,
       compute_consumed, ai_engaged, first_activity_at, last_activity_at,
       source_confidence
     )
     SELECT
       account_id, (occurred_at AT TIME ZONE 'UTC')::date, $2, home_bay_id,
       BOOL_OR(event_name IN (
         'app_foreground', 'project_engaged', 'project_work',
         'ai_prompt_submitted', 'first_self_directed_work'
       )),
       BOOL_OR(event_name IN (
         'project_engaged', 'project_work', 'ai_prompt_submitted',
         'first_self_directed_work'
       )),
       BOOL_OR(event_name IN (
         'project_work', 'ai_prompt_submitted', 'first_self_directed_work'
       )),
       BOOL_OR(event_name = 'first_self_directed_work'),
       FALSE,
       BOOL_OR(event_name = 'ai_prompt_submitted'),
       MIN(occurred_at), MAX(occurred_at),
       CASE
         WHEN BOOL_AND(COALESCE(properties->>'source_confidence', '') = 'legacy_proxy')
         THEN 'legacy_proxy' ELSE 'canonical'
       END
     FROM growth_event_log
     WHERE event_id = ANY($1::uuid[])
       AND event_name IN (
         'app_foreground', 'project_engaged', 'project_work',
         'ai_prompt_submitted', 'first_self_directed_work'
       )
     GROUP BY account_id, (occurred_at AT TIME ZONE 'UTC')::date, home_bay_id
     ON CONFLICT (account_id, activity_date, metric_contract_version)
     DO UPDATE SET
       app_foreground=growth_account_activity_daily.app_foreground OR EXCLUDED.app_foreground,
       project_engaged=growth_account_activity_daily.project_engaged OR EXCLUDED.project_engaged,
       project_work=growth_account_activity_daily.project_work OR EXCLUDED.project_work,
       self_directed_work=growth_account_activity_daily.self_directed_work OR EXCLUDED.self_directed_work,
       compute_consumed=growth_account_activity_daily.compute_consumed OR EXCLUDED.compute_consumed,
       ai_engaged=growth_account_activity_daily.ai_engaged OR EXCLUDED.ai_engaged,
       first_activity_at=LEAST(growth_account_activity_daily.first_activity_at, EXCLUDED.first_activity_at),
       last_activity_at=GREATEST(growth_account_activity_daily.last_activity_at, EXCLUDED.last_activity_at),
       source_confidence=CASE
         WHEN growth_account_activity_daily.source_confidence = 'canonical'
           OR EXCLUDED.source_confidence = 'canonical'
         THEN 'canonical' ELSE EXCLUDED.source_confidence
       END,
       updated_at=NOW()`,
    [eventIds, GROWTH_METRIC_VERSION],
  );
  await client.query(
    `INSERT INTO growth_dirty_periods
       (metric_version, scope_id, period_grain, period_start, reason)
     SELECT DISTINCT $2, $3, dirty.grain, dirty.period_start, 'new_event'
       FROM growth_event_log AS event
       JOIN growth_account_profiles AS profile USING (account_id)
       CROSS JOIN LATERAL (
         VALUES
           ('calendar_day', (event.occurred_at AT TIME ZONE 'UTC')::date, TRUE),
           ('calendar_week', date_trunc('week', event.occurred_at AT TIME ZONE 'UTC')::date, TRUE),
           ('cohort_day', profile.cohort_date, profile.legacy_status='new'),
           ('cohort_week', profile.cohort_week, profile.legacy_status='new')
       ) AS dirty(grain, period_start, eligible)
      WHERE event.event_id = ANY($1::uuid[])
        AND dirty.eligible
     ON CONFLICT (metric_version, scope_id, period_grain, period_start)
     DO UPDATE SET reason=EXCLUDED.reason, updated_at=NOW()`,
    [eventIds, GROWTH_METRIC_VERSION, scopeId],
  );
}

async function upsertMetric(
  client: PoolClient,
  scopeId: string,
  periodStart: string,
): Promise<void> {
  await client.query(
    `WITH metrics AS (
       SELECT 'eligible_signups'::text AS metric_name,
              COUNT(*)::int AS numerator, NULL::int AS denominator
         FROM growth_account_profiles
        WHERE home_bay_id=$1 AND cohort_date=$2::date
          AND excluded_from_growth=FALSE AND legacy_status='new'
       UNION ALL
       SELECT 'verified_accounts', COUNT(*)::int, NULL::int
         FROM growth_account_profiles
        WHERE home_bay_id=$1 AND cohort_date=$2::date
          AND excluded_from_growth=FALSE AND legacy_status='new'
          AND verified_at IS NOT NULL
       UNION ALL
       SELECT 'activated_24h', COUNT(*)::int, NULL::int
         FROM growth_account_profiles AS profile
         JOIN growth_account_milestones AS milestone
           ON milestone.account_id=profile.account_id
          AND milestone.milestone='first_meaningful_work'
          AND milestone.definition_version=$3
        WHERE profile.home_bay_id=$1 AND profile.cohort_date=$2::date
          AND profile.excluded_from_growth=FALSE
          AND profile.legacy_status='new'
          AND milestone.occurred_at <= profile.account_created_at + INTERVAL '24 hours'
       UNION ALL
       SELECT 'project_created', COUNT(*)::int, NULL::int
         FROM growth_account_profiles AS profile
         JOIN growth_account_milestones AS milestone
           ON milestone.account_id=profile.account_id
          AND milestone.milestone='project_created'
          AND milestone.definition_version=$3
        WHERE profile.home_bay_id=$1 AND profile.cohort_date=$2::date
          AND profile.excluded_from_growth=FALSE
          AND profile.legacy_status='new'
       UNION ALL
       SELECT 'project_surface_visible', COUNT(*)::int, NULL::int
         FROM growth_account_profiles AS profile
         JOIN growth_account_milestones AS milestone
           ON milestone.account_id=profile.account_id
          AND milestone.milestone='project_surface_visible'
          AND milestone.definition_version=$3
        WHERE profile.home_bay_id=$1 AND profile.cohort_date=$2::date
          AND profile.excluded_from_growth=FALSE
          AND profile.legacy_status='new'
       UNION ALL
       SELECT 'first_meaningful_work', COUNT(*)::int, NULL::int
         FROM growth_account_profiles AS profile
         JOIN growth_account_milestones AS milestone
           ON milestone.account_id=profile.account_id
          AND milestone.milestone='first_meaningful_work'
          AND milestone.definition_version=$3
        WHERE profile.home_bay_id=$1 AND profile.cohort_date=$2::date
          AND profile.excluded_from_growth=FALSE
          AND profile.legacy_status='new'
       UNION ALL
       SELECT 'project_engaged_v1', COUNT(*)::int, NULL::int
         FROM growth_account_activity_daily AS activity
         JOIN growth_account_profiles AS profile USING (account_id)
        WHERE activity.home_bay_id=$1 AND activity.activity_date=$2::date
          AND activity.metric_contract_version=$3
          AND activity.project_engaged AND profile.excluded_from_growth=FALSE
       UNION ALL
       SELECT 'project_work_v1', COUNT(*)::int, NULL::int
         FROM growth_account_activity_daily AS activity
         JOIN growth_account_profiles AS profile USING (account_id)
        WHERE activity.home_bay_id=$1 AND activity.activity_date=$2::date
          AND activity.metric_contract_version=$3
          AND activity.project_work AND profile.excluded_from_growth=FALSE
       UNION ALL
       SELECT 'app_foreground_v1', COUNT(*)::int, NULL::int
         FROM growth_account_activity_daily AS activity
         JOIN growth_account_profiles AS profile USING (account_id)
        WHERE activity.home_bay_id=$1 AND activity.activity_date=$2::date
          AND activity.metric_contract_version=$3
          AND activity.app_foreground AND profile.excluded_from_growth=FALSE
       UNION ALL
       SELECT 'ai_engaged_v1', COUNT(*)::int, NULL::int
         FROM growth_account_activity_daily AS activity
         JOIN growth_account_profiles AS profile USING (account_id)
        WHERE activity.home_bay_id=$1 AND activity.activity_date=$2::date
          AND activity.metric_contract_version=$3
          AND activity.ai_engaged AND profile.excluded_from_growth=FALSE
       UNION ALL
       SELECT 'self_directed_work_v1', COUNT(*)::int, NULL::int
         FROM growth_account_activity_daily AS activity
         JOIN growth_account_profiles AS profile USING (account_id)
        WHERE activity.home_bay_id=$1 AND activity.activity_date=$2::date
          AND activity.metric_contract_version=$3
          AND activity.self_directed_work AND profile.excluded_from_growth=FALSE
     )
     INSERT INTO growth_metric_series
       (scope_id, metric_name, metric_version, period_grain, period_start,
        segment_set, segment_value, value, numerator, denominator, partial)
     SELECT $1, metric_name, $3, 'day', $2::date, 'overall', 'all',
            numerator::double precision, numerator, denominator,
            $2::date >= (NOW() AT TIME ZONE 'UTC')::date
       FROM metrics
     ON CONFLICT (
       scope_id, metric_name, metric_version, period_grain, period_start,
       segment_set, segment_value
     ) DO UPDATE SET value=EXCLUDED.value, numerator=EXCLUDED.numerator,
       denominator=EXCLUDED.denominator, partial=EXCLUDED.partial,
       materialized_at=NOW()`,
    [scopeId, periodStart, GROWTH_METRIC_VERSION],
  );
}

function signalColumn(signal: string): string {
  switch (signal) {
    case "project_work_v1":
      return "project_work";
    case "app_foreground_v1":
      return "app_foreground";
    case "ai_engaged_v1":
      return "ai_engaged";
    case "self_directed_work_v1":
      return "self_directed_work";
    default:
      return "project_engaged";
  }
}

async function rebuildRetentionCohort({
  client,
  scopeId,
  grain,
  cohortStart,
}: {
  client: PoolClient;
  scopeId: string;
  grain: "day" | "week";
  cohortStart: string;
}): Promise<void> {
  const periodCount = grain === "week" ? 12 : 30;
  const interval = grain === "week" ? "1 week" : "1 day";
  for (const signal of [
    "project_engaged_v1",
    "project_work_v1",
    "app_foreground_v1",
    "ai_engaged_v1",
    "self_directed_work_v1",
  ]) {
    const column = signalColumn(signal);
    await client.query(
      `WITH cohort AS (
         SELECT account_id
          FROM growth_account_profiles
          WHERE home_bay_id=$1 AND excluded_from_growth=FALSE
            AND legacy_status='new'
            AND ${grain === "week" ? "cohort_week" : "cohort_date"}=$2::date
       ), offsets AS (
         SELECT generate_series(0, $3::int - 1)::int AS period_index
       ), active AS (
         SELECT DISTINCT activity.account_id,
           FLOOR(EXTRACT(EPOCH FROM (
             date_trunc('${grain}', activity.activity_date::timestamp)
             - $2::date::timestamp
           )) / ${grain === "week" ? 604800 : 86400})::int AS period_index
         FROM growth_account_activity_daily AS activity
         JOIN cohort USING (account_id)
         WHERE activity.metric_contract_version=$4
           AND activity.${column}=TRUE
           AND activity.activity_date >= $2::date
           AND activity.activity_date < $2::date + $3::int * INTERVAL '${interval}'
       ), counts AS (
         SELECT offsets.period_index,
                (SELECT COUNT(*)::int FROM cohort) AS cohort_size,
                (SELECT COUNT(DISTINCT account_id)::int FROM active
                  WHERE active.period_index=offsets.period_index) AS exact_count,
                (SELECT COUNT(DISTINCT account_id)::int FROM active
                  WHERE active.period_index>=offsets.period_index) AS rolling_count
           FROM offsets
       )
       INSERT INTO growth_retention_cells
         (scope_id, cohort_grain, cohort_start, activity_signal,
          metric_version, period_index, segment_set, segment_value,
          cohort_size, exact_active_accounts, rolling_active_accounts, complete)
       SELECT $1, '${grain}', $2::date, $5, $4, period_index,
              'overall', 'all', cohort_size, exact_count, rolling_count,
              $2::date + (period_index + 1) * INTERVAL '${interval}'
                <= date_trunc('${grain}', NOW() AT TIME ZONE 'UTC')
         FROM counts
       ON CONFLICT (
         scope_id, cohort_grain, cohort_start, activity_signal,
         metric_version, period_index, segment_set, segment_value
       ) DO UPDATE SET cohort_size=EXCLUDED.cohort_size,
         exact_active_accounts=EXCLUDED.exact_active_accounts,
         rolling_active_accounts=EXCLUDED.rolling_active_accounts,
         complete=EXCLUDED.complete, materialized_at=NOW()`,
      [scopeId, cohortStart, periodCount, GROWTH_METRIC_VERSION, signal],
    );
  }
}

async function rebuildWeeklyAccounting(
  client: PoolClient,
  scopeId: string,
  weekStart: string,
): Promise<void> {
  for (const signal of ["project_engaged_v1", "project_work_v1"]) {
    const column = signalColumn(signal);
    await client.query(
      `WITH eligible_activity AS (
         SELECT activity.account_id, activity.activity_date
           FROM growth_account_activity_daily AS activity
           JOIN growth_account_profiles AS profile USING (account_id)
          WHERE activity.metric_contract_version=$3
            AND activity.home_bay_id=$1 AND profile.home_bay_id=$1
            AND activity.${column}=TRUE
            AND profile.excluded_from_growth=FALSE
       ), current_accounts AS (
         SELECT DISTINCT account_id FROM eligible_activity
          WHERE activity_date >= $2::date
            AND activity_date < $2::date + INTERVAL '1 week'
       ), previous_accounts AS (
         SELECT DISTINCT account_id FROM eligible_activity
          WHERE activity_date >= $2::date - INTERVAL '1 week'
            AND activity_date < $2::date
       ), earlier_accounts AS (
         SELECT DISTINCT account_id FROM eligible_activity
          WHERE activity_date < $2::date - INTERVAL '1 week'
       ), counts AS (
         SELECT
           COUNT(*) FILTER (WHERE previous.account_id IS NULL AND earlier.account_id IS NULL)::int AS new_count,
           COUNT(*) FILTER (WHERE previous.account_id IS NOT NULL)::int AS retained_count,
           COUNT(*) FILTER (WHERE previous.account_id IS NULL AND earlier.account_id IS NOT NULL)::int AS resurrected_count
         FROM current_accounts AS current
         LEFT JOIN previous_accounts AS previous USING (account_id)
         LEFT JOIN earlier_accounts AS earlier USING (account_id)
       ), churn AS (
         SELECT COUNT(*)::int AS churned_count
         FROM previous_accounts AS previous
         LEFT JOIN current_accounts AS current USING (account_id)
         WHERE current.account_id IS NULL
       )
       INSERT INTO growth_weekly_accounting
         (scope_id, week_start, activity_signal, metric_version,
          segment_set, segment_value, new_accounts, retained_accounts,
          resurrected_accounts, churned_accounts, partial)
       SELECT $1, $2::date, $4, $3, 'overall', 'all', new_count,
              retained_count, resurrected_count, churned_count,
              $2::date + INTERVAL '1 week' > date_trunc('week', NOW() AT TIME ZONE 'UTC')
         FROM counts CROSS JOIN churn
       ON CONFLICT (
         scope_id, week_start, activity_signal, metric_version,
         segment_set, segment_value
       ) DO UPDATE SET new_accounts=EXCLUDED.new_accounts,
         retained_accounts=EXCLUDED.retained_accounts,
         resurrected_accounts=EXCLUDED.resurrected_accounts,
         churned_accounts=EXCLUDED.churned_accounts,
         partial=EXCLUDED.partial, materialized_at=NOW()`,
      [scopeId, weekStart, GROWTH_METRIC_VERSION, signal],
    );
  }
}

async function repairDirtyPeriods(
  client: PoolClient,
  scopeId: string,
): Promise<number> {
  const { rows } = await client.query<{
    period_grain: string;
    period_start: string;
  }>(
    `SELECT period_grain, period_start::text
       FROM growth_dirty_periods
      WHERE metric_version=$1 AND scope_id=$2
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 80`,
    [GROWTH_METRIC_VERSION, scopeId],
  );
  for (const row of rows) {
    if (row.period_grain === "calendar_day") {
      await upsertMetric(client, scopeId, row.period_start);
    } else if (row.period_grain === "cohort_day") {
      await rebuildRetentionCohort({
        client,
        scopeId,
        grain: "day",
        cohortStart: row.period_start,
      });
    } else if (row.period_grain === "cohort_week") {
      await rebuildRetentionCohort({
        client,
        scopeId,
        grain: "week",
        cohortStart: row.period_start,
      });
    } else if (row.period_grain === "calendar_week") {
      await rebuildWeeklyAccounting(client, scopeId, row.period_start);
      const next = await client.query<{ next_week: string }>(
        "SELECT ($1::date + INTERVAL '1 week')::date::text AS next_week",
        [row.period_start],
      );
      await rebuildWeeklyAccounting(client, scopeId, next.rows[0].next_week);
    }
    await client.query(
      `DELETE FROM growth_dirty_periods
        WHERE metric_version=$1 AND scope_id=$2
          AND period_grain=$3 AND period_start=$4::date`,
      [GROWTH_METRIC_VERSION, scopeId, row.period_grain, row.period_start],
    );
  }
  return rows.length;
}

async function enqueueRoutineRepairs(
  client: PoolClient,
  scopeId: string,
  lastSuccessAt?: Date | null,
): Promise<void> {
  const crossedUtcDay =
    lastSuccessAt == null ||
    lastSuccessAt.toISOString().slice(0, 10) !==
      new Date().toISOString().slice(0, 10);
  await client.query(
    `INSERT INTO growth_dirty_periods
       (metric_version, scope_id, period_grain, period_start, reason)
     SELECT $1, $2, 'calendar_day', day::date, 'routine_freshness'
       FROM generate_series(
         (NOW() AT TIME ZONE 'UTC')::date - INTERVAL '3 days',
         (NOW() AT TIME ZONE 'UTC')::date,
         INTERVAL '1 day'
       ) AS day
     ON CONFLICT (metric_version, scope_id, period_grain, period_start)
     DO UPDATE SET reason=EXCLUDED.reason, updated_at=NOW()`,
    [GROWTH_METRIC_VERSION, scopeId],
  );
  if (!crossedUtcDay) return;
  await client.query(
    `INSERT INTO growth_dirty_periods
       (metric_version, scope_id, period_grain, period_start, reason)
     SELECT $1, $2, dirty.grain, dirty.period_start, 'period_maturity'
       FROM (
         SELECT 'cohort_day'::text AS grain, cohort_date AS period_start
          FROM growth_account_profiles
          WHERE home_bay_id=$2
            AND legacy_status='new'
            AND cohort_date >= (NOW() AT TIME ZONE 'UTC')::date - INTERVAL '35 days'
          GROUP BY cohort_date
         UNION ALL
         SELECT 'cohort_week', cohort_week
          FROM growth_account_profiles
          WHERE home_bay_id=$2
            AND legacy_status='new'
            AND cohort_week >= date_trunc('week', NOW() AT TIME ZONE 'UTC')::date - INTERVAL '12 weeks'
          GROUP BY cohort_week
         UNION ALL
         SELECT 'calendar_week', week::date
           FROM generate_series(
             date_trunc('week', NOW() AT TIME ZONE 'UTC') - INTERVAL '2 weeks',
             date_trunc('week', NOW() AT TIME ZONE 'UTC'),
             INTERVAL '1 week'
           ) AS week
       ) AS dirty
     ON CONFLICT (metric_version, scope_id, period_grain, period_start)
     DO UPDATE SET reason=EXCLUDED.reason, updated_at=NOW()`,
    [GROWTH_METRIC_VERSION, scopeId],
  );
}

async function pruneRawEvents(client: PoolClient): Promise<number> {
  const result = await client.query(
    `WITH doomed AS (
       SELECT event_id FROM growth_event_log
        WHERE received_at < NOW() - ($1::text || ' days')::interval
        ORDER BY received_at
        FOR UPDATE SKIP LOCKED
        LIMIT 5000
     )
     DELETE FROM growth_event_log AS event USING doomed
      WHERE event.event_id=doomed.event_id`,
    [RETENTION_DAYS],
  );
  return result.rowCount ?? 0;
}

export type GrowthMaterializationResult =
  | { status: "locked" }
  | {
      status: "ok";
      profiles: number;
      profile_exclusions: number;
      events: number;
      dirty_periods: number;
      pruned_events: number;
      duration_ms: number;
    };

export async function runGrowthMaterializationOnce(): Promise<GrowthMaterializationResult> {
  const started = Date.now();
  const scopeId = getConfiguredBayId();
  const client = await getPoolClient();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [`${LOCK_NAME}:${scopeId}`],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { status: "locked" };
    await client.query("BEGIN");
    await ensureState(client, scopeId);
    const state = await client.query<{
      source_watermark: unknown;
      last_success_at: Date | null;
      coverage_started_at: Date;
    }>(
      `SELECT source_watermark, last_success_at, coverage_started_at
         FROM growth_materialization_state
        WHERE worker_name=$1 AND scope_id=$2 FOR UPDATE`,
      [WORKER_NAME, scopeId],
    );
    const profiles = await backfillProfiles(
      client,
      scopeId,
      state.rows[0].coverage_started_at,
    );
    const profileExclusions = await reconcileProfileExclusions(client, scopeId);
    const events = await selectEventBatch(
      client,
      scopeId,
      parseWatermark(state.rows[0]?.source_watermark),
    );
    await materializeEvents(
      client,
      events.map(({ event_id }) => event_id),
      scopeId,
    );
    await enqueueRoutineRepairs(
      client,
      scopeId,
      state.rows[0]?.last_success_at,
    );
    const dirtyPeriods = await repairDirtyPeriods(client, scopeId);
    const prunedEvents = await pruneRawEvents(client);
    const last = events.at(-1);
    const durationMs = Date.now() - started;
    await client.query(
      `UPDATE growth_materialization_state
          SET source_watermark=CASE WHEN $3::timestamptz IS NULL
                THEN source_watermark
                ELSE jsonb_build_object(
                  'received_at', $3::timestamptz,
                  'event_id', $4::text
                )
              END,
              last_success_at=NOW(), last_duration_ms=$5,
              rows_processed=$6, last_error=NULL, updated_at=NOW()
        WHERE worker_name=$1 AND scope_id=$2`,
      [
        WORKER_NAME,
        scopeId,
        last?.received_at ?? null,
        last?.event_id ?? null,
        durationMs,
        events.length,
      ],
    );
    await client.query("COMMIT");
    return {
      status: "ok",
      profiles,
      profile_exclusions: profileExclusions,
      events: events.length,
      dirty_periods: dirtyPeriods,
      pruned_events: prunedEvents,
      duration_ms: durationMs,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    await client
      .query(
        `UPDATE growth_materialization_state SET last_error=$3, updated_at=NOW()
          WHERE worker_name=$1 AND scope_id=$2`,
        [WORKER_NAME, scopeId, `${err}`.slice(0, 4000)],
      )
      .catch(() => {});
    logger.warn("growth analytics materialization failed", { err: `${err}` });
    throw err;
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext($1))", [
          `${LOCK_NAME}:${scopeId}`,
        ])
        .catch(() => {});
    }
    client.release();
  }
}

export const __test__ = { parseWatermark, signalColumn };
