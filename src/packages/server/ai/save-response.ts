import getLogger from "@cocalc/backend/logger";
import getPool from "@cocalc/database/pool";
import { pii_retention_to_future } from "@cocalc/database/postgres/account/pii";
import { getServerSettings } from "@cocalc/database/settings/server-settings";
import { AIUsageLogEntry } from "@cocalc/util/db-schema/ai-log";
import { ensureAccountUsageWindowsForEvent } from "@cocalc/server/membership/usage-windows";
import { AI_USAGE_UNITS_PER_DOLLAR } from "./usage-units";
import { getConfiguredBayId } from "@cocalc/server/bay-config";

const log = getLogger("ai:save-response");

// time, id is set by the database, and expire in the saveAIResponse function
type SaveAIResponseProps = Omit<AIUsageLogEntry, "time" | "id" | "expire"> & {
  occurred_at?: Date | string;
};

let ensuredExactUsageSchema: Promise<void> | undefined;

export async function ensureExactAIUsageSchema(): Promise<void> {
  if (!ensuredExactUsageSchema) {
    ensuredExactUsageSchema = (async () => {
      const pool = getPool();
      await pool.query(
        "ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS cost_microusd BIGINT",
      );
      await pool.query(
        "ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS funded_turn_id UUID",
      );
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_log_funded_turn_id_unique_idx
           ON ai_usage_log(funded_turn_id) WHERE funded_turn_id IS NOT NULL`,
      );
    })().catch((err) => {
      ensuredExactUsageSchema = undefined;
      throw err;
    });
  }
  await ensuredExactUsageSchema;
}

// Save the response to the historical AI usage log table.
export async function saveAIResponse({
  account_id,
  analytics_cookie,
  cost_microusd,
  funded_turn_id,
  history,
  input,
  model,
  occurred_at,
  output,
  path,
  project_id,
  prompt_tokens,
  system,
  tag,
  total_time_s,
  total_tokens,
  usage_units,
}: SaveAIResponseProps): Promise<boolean> {
  const expire: AIUsageLogEntry["expire"] = await getExpiration(account_id);
  const pool = getPool();
  try {
    await ensureExactAIUsageSchema();
    if (account_id) {
      await ensureAccountUsageWindowsForEvent({
        account_id,
        occurred_at,
      });
    }
    await pool.query(
      `INSERT INTO ai_usage_log(
         time,input,system,output,history,account_id,analytics_cookie,project_id,
         path,total_tokens,prompt_tokens,total_time_s,expire,model,tag,
         usage_units,cost_microusd,funded_turn_id
       ) VALUES(
         COALESCE($18::timestamptz, NOW()),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
       ) ON CONFLICT (funded_turn_id) WHERE funded_turn_id IS NOT NULL DO NOTHING`,
      [
        input,
        system,
        output,
        history,
        account_id,
        analytics_cookie,
        project_id,
        path,
        total_tokens,
        prompt_tokens,
        total_time_s,
        expire,
        model,
        tag,
        usage_units ?? null,
        cost_microusd ??
          (usage_units == null
            ? null
            : Math.max(
                0,
                Math.round(
                  (usage_units * 1_000_000) / AI_USAGE_UNITS_PER_DOLLAR,
                ),
              )),
        funded_turn_id ?? null,
        occurred_at ?? null,
      ],
    );
    return true;
  } catch (err) {
    log.warn("Failed to save AI usage log entry to database:", err);
    return false;
  }
}

export async function recordSiteFundedCodexAccountUsage({
  account_id,
  funded_turn_id,
  project_id,
  cost_microusd,
  occurred_at,
}: {
  account_id: string;
  funded_turn_id: string;
  project_id: string;
  cost_microusd: number;
  occurred_at?: Date | string;
}): Promise<void> {
  if (!Number.isSafeInteger(cost_microusd) || cost_microusd < 0) {
    throw new Error("cost_microusd must be a nonnegative safe integer");
  }
  const saved = await saveAIResponse({
    account_id,
    analytics_cookie: undefined,
    cost_microusd,
    funded_turn_id,
    history: [],
    input: "[site-funded-codex]",
    output: "",
    occurred_at,
    project_id,
    prompt_tokens: 0,
    system: "",
    tag: "site-funded-codex",
    total_time_s: 0,
    total_tokens: 0,
    usage_units: undefined,
  });
  if (!saved) {
    throw new Error("failed to record site-funded Codex account usage");
  }
}

export async function backfillLocalSiteFundedCodexAccountUsage(
  account_id: string,
): Promise<number> {
  await ensureExactAIUsageSchema();
  const pool = getPool();
  const exists = await pool.query<{ relation: string | null }>(
    "SELECT to_regclass('public.site_ai_turn_reservations')::text AS relation",
  );
  if (!exists.rows[0]?.relation) return 0;
  const { rows } = await pool.query<{
    funded_turn_id: string;
    project_id: string;
    committed_microusd: string | number;
    completed_at: Date | string;
  }>(
    `SELECT r.funded_turn_id, r.project_id, r.committed_microusd,
            r.completed_at
       FROM site_ai_turn_reservations r
       LEFT JOIN ai_usage_log a ON a.funded_turn_id = r.funded_turn_id
      WHERE r.account_id = $1
        AND r.committed_microusd > 0
        AND r.completed_at IS NOT NULL
        AND COALESCE(NULLIF(BTRIM(r.home_bay_id), ''), $2) = $2
        AND a.funded_turn_id IS NULL
      ORDER BY r.completed_at`,
    [account_id, getConfiguredBayId()],
  );
  for (const row of rows) {
    await recordSiteFundedCodexAccountUsage({
      account_id,
      funded_turn_id: row.funded_turn_id,
      project_id: row.project_id,
      cost_microusd: Number(row.committed_microusd),
      occurred_at: row.completed_at,
    });
  }
  return rows.length;
}

async function getExpiration(account_id: string | undefined) {
  // NOTE about expire: If the admin setting for "PII Retention" is set *and*
  // the usage is only identified by their analytics_cookie, then
  // we automatically delete the AI usage log at the expiration time.
  // If the account_id *is* set, users can:
  // 1. Delete their past AI usage.
  // 2. Have past AI usage deleted when they delete their account.
  // 3. Search and inspect their past usage.
  // See https://github.com/sagemathinc/cocalc/issues/6577
  if (account_id == null) {
    const { pii_retention } = await getServerSettings();
    return pii_retention_to_future(pii_retention);
  } else {
    return undefined;
  }
}
