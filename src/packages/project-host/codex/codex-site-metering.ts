import getLogger from "@cocalc/backend/logger";
import callHub from "@cocalc/conat/hub/call-hub";
import {
  setCodexSiteKeyGovernor,
  type CodexSiteFundedTurnRequest,
  type CodexSiteFundedTurnRuntime,
} from "@cocalc/ai/acp";
import { getMasterConatClient } from "../master-status";
import { getLocalHostId } from "../sqlite/hosts";
import { getDatabase, initDatabase } from "@cocalc/lite/hub/sqlite/database";
import type {
  SiteFundedCodexAdmission,
  SiteFundedCodexUsageEvent,
} from "@cocalc/util/ai/site-funded-codex";
import { startSiteFundedCodexProxySession } from "./site-funded-proxy";

const logger = getLogger("project-host:codex-site-metering");

function getHubCaller():
  | {
      client: NonNullable<ReturnType<typeof getMasterConatClient>>;
      host_id: string;
    }
  | undefined {
  const client = getMasterConatClient();
  const host_id = getLocalHostId();
  if (!client || !host_id) {
    return;
  }
  return { client, host_id };
}

const SITE_KEY_POLL_MS = Math.max(
  30_000,
  Number(process.env.COCALC_CODEX_SITE_USAGE_POLL_MS ?? 2 * 60_000),
);

const SITE_KEY_FAIL_OPEN_MS = Math.max(
  10_000,
  Number(process.env.COCALC_CODEX_SITE_FAIL_OPEN_MS ?? 5 * 60_000),
);

function getConfiguredMaxTurnMs(): number | undefined {
  const raw = process.env.COCALC_CODEX_SITE_MAX_TURN_MS;
  if (raw == null || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.max(60_000, n);
}

const SITE_KEY_MAX_TURN_MS = getConfiguredMaxTurnMs();

let meteringHealth: {
  failingSince?: number;
  lastError?: string;
} = {};

function markMeteringSuccess() {
  meteringHealth = {};
}

function markMeteringFailure(err: unknown): {
  deny: boolean;
  reason: string;
} {
  const now = Date.now();
  if (!meteringHealth.failingSince) {
    meteringHealth.failingSince = now;
  }
  meteringHealth.lastError = `${err}`;
  const failingFor = now - meteringHealth.failingSince;
  if (failingFor <= SITE_KEY_FAIL_OPEN_MS) {
    return {
      deny: false,
      reason: "",
    };
  }
  return {
    deny: true,
    reason:
      "Site usage checks are temporarily unavailable, so CoCalc Membership Codex access is paused. Please retry shortly.",
  };
}

export function initCodexSiteKeyGovernor(): void {
  setCodexSiteKeyGovernor({
    pollIntervalMs: SITE_KEY_POLL_MS,
    ...(SITE_KEY_MAX_TURN_MS == null
      ? {}
      : { maxTurnMs: SITE_KEY_MAX_TURN_MS }),
    async checkAllowed({ accountId, projectId, model }) {
      const caller = getHubCaller();
      if (!caller) {
        const verdict = markMeteringFailure("missing hub caller");
        if (verdict.deny) {
          return { allowed: false, reason: verdict.reason };
        }
        return { allowed: true };
      }
      try {
        const result = await callHub({
          ...caller,
          name: "hosts.checkCodexSiteUsageAllowance",
          args: [
            {
              account_id: accountId,
              project_id: projectId,
              model,
            },
          ],
          timeout: 15_000,
        });
        markMeteringSuccess();
        return {
          allowed: !!result?.allowed,
          reason: result?.reason,
          window: result?.window,
          reset_in: result?.reset_in,
        };
      } catch (err) {
        logger.warn("checkCodexSiteUsageAllowance failed", {
          accountId,
          projectId,
          model,
          err: `${err}`,
        });
        const verdict = markMeteringFailure(err);
        // Intentional: fail open briefly for transient hub/network failures so
        // user turns are not disrupted, then fail closed if outage persists.
        if (verdict.deny) {
          return { allowed: false, reason: verdict.reason };
        }
        return { allowed: true };
      }
    },
    async reportUsage({
      accountId,
      projectId,
      model,
      usage,
      totalTimeS,
      path,
    }) {
      const caller = getHubCaller();
      if (!caller) {
        return;
      }
      await callHub({
        ...caller,
        name: "hosts.recordCodexSiteUsage",
        args: [
          {
            account_id: accountId,
            project_id: projectId,
            model,
            path,
            prompt_tokens: Math.max(0, usage.input_tokens),
            completion_tokens: Math.max(0, usage.output_tokens),
            total_time_s: Math.max(0, totalTimeS),
          },
        ],
        timeout: 15_000,
      });
    },
  });
  void flushSiteFundedCodexOutbox();
}

type OutboxRecord = {
  id: number;
  kind: "usage" | "finish";
  payload: string;
};

function ensureOutbox(): void {
  initDatabase().exec(`
    CREATE TABLE IF NOT EXISTS site_funded_codex_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('usage', 'finish')),
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}

function enqueueOutbox(kind: OutboxRecord["kind"], payload: unknown): void {
  ensureOutbox();
  getDatabase()
    .prepare(
      `INSERT INTO site_funded_codex_outbox(kind, payload, created_at)
       VALUES (?, ?, ?)`,
    )
    .run(kind, JSON.stringify(payload), Date.now());
}

let flushingOutbox = false;

export async function flushSiteFundedCodexOutbox(): Promise<void> {
  if (flushingOutbox) return;
  const caller = getHubCaller();
  if (!caller) return;
  ensureOutbox();
  flushingOutbox = true;
  try {
    while (true) {
      const row = getDatabase()
        .prepare(
          `SELECT id, kind, payload FROM site_funded_codex_outbox
           ORDER BY id LIMIT 1`,
        )
        .get() as OutboxRecord | undefined;
      if (!row) return;
      const payload = JSON.parse(row.payload);
      if (row.kind === "usage") {
        await callHub({
          ...caller,
          name: "hosts.recordSiteFundedCodexUsageEvent",
          args: [{ event: payload }],
          timeout: 15_000,
        });
      } else {
        await callHub({
          ...caller,
          name: "hosts.finishSiteFundedCodexTurn",
          args: [payload],
          timeout: 15_000,
        });
      }
      getDatabase()
        .prepare(`DELETE FROM site_funded_codex_outbox WHERE id = ?`)
        .run(row.id);
    }
  } catch (err) {
    logger.warn("site-funded Codex outbox flush failed", { err: `${err}` });
  } finally {
    flushingOutbox = false;
  }
}

async function persistUsageEvent(
  event: SiteFundedCodexUsageEvent,
): Promise<void> {
  enqueueOutbox("usage", event);
  await flushSiteFundedCodexOutbox();
}

export async function beginSiteFundedCodexTurn({
  accountId,
  projectId,
  fundedTurnId,
  idempotencyKey,
  path,
  apiKey,
}: {
  accountId: string;
  projectId: string;
  fundedTurnId: string;
  idempotencyKey: string;
  path?: string;
  apiKey: string;
}): Promise<CodexSiteFundedTurnRuntime> {
  const caller = getHubCaller();
  if (!caller) {
    throw Object.assign(
      new Error("Site-funded Codex admission is temporarily unavailable."),
      { code: "unavailable" },
    );
  }
  const reserve = async (
    request: CodexSiteFundedTurnRequest,
  ): Promise<Extract<SiteFundedCodexAdmission, { allowed: true }>> => {
    const admission = (await callHub({
      ...caller,
      name: "hosts.reserveSiteFundedCodexTurn",
      args: [
        {
          account_id: accountId,
          project_id: projectId,
          funded_turn_id: request.fundedTurnId,
          idempotency_key: request.idempotencyKey,
          path: request.path,
        },
      ],
      timeout: 20_000,
    })) as SiteFundedCodexAdmission;
    if (!admission.allowed) {
      throw Object.assign(new Error(admission.reason), {
        code: admission.code,
      });
    }
    return admission;
  };
  const admission = await reserve({ fundedTurnId, idempotencyKey, path });
  let proxySession;
  try {
    proxySession = await startSiteFundedCodexProxySession({
      reservation: admission.reservation,
      apiKey,
      onUsage: persistUsageEvent,
    });
  } catch (err) {
    enqueueOutbox("finish", {
      reservation_id: admission.reservation.reservationId,
      status: "released",
      outcome: "provider proxy failed to start",
    });
    await flushSiteFundedCodexOutbox();
    throw err;
  }
  let runtimeClosed = false;
  let activeFinish:
    | ((opts: {
        status: "committed" | "interrupted" | "failed" | "released";
        outcome?: string;
      }) => Promise<void>)
    | undefined;

  const createTurnRuntime = (
    currentAdmission: Extract<SiteFundedCodexAdmission, { allowed: true }>,
  ): CodexSiteFundedTurnRuntime => {
    let finished = false;
    const reservationId = currentAdmission.reservation.reservationId;
    const heartbeat = setInterval(() => {
      void callHub({
        ...caller,
        name: "hosts.heartbeatSiteFundedCodexTurn",
        args: [{ reservation_id: reservationId }],
        timeout: 15_000,
      })
        .then((result) => {
          if (!result?.active) proxySession.deactivate(reservationId);
        })
        .catch((err) => {
          logger.warn("site-funded Codex heartbeat failed", {
            reservationId,
            err: `${err}`,
          });
        });
    }, currentAdmission.reservation.heartbeatIntervalMs);
    heartbeat.unref();

    const finish: CodexSiteFundedTurnRuntime["finish"] = async ({
      status,
      outcome,
    }) => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat);
      proxySession.deactivate(reservationId);
      enqueueOutbox("finish", {
        reservation_id: reservationId,
        status,
        outcome,
      });
      await flushSiteFundedCodexOutbox();
    };
    activeFinish = finish;

    return {
      reservation: currentAdmission.reservation,
      policy: currentAdmission.reservation.policy,
      providerBaseUrl: proxySession.baseUrl,
      providerToken: proxySession.token,
      finish,
      beginTurn: async (request) => {
        if (runtimeClosed) {
          throw new Error("site-funded Codex runtime is closed");
        }
        if (!finished) {
          throw new Error(
            "cannot begin a site-funded Codex turn before the previous turn finishes",
          );
        }
        const nextAdmission = await reserve(request);
        try {
          proxySession.activate({
            reservation: nextAdmission.reservation,
            onUsage: persistUsageEvent,
          });
        } catch (err) {
          enqueueOutbox("finish", {
            reservation_id: nextAdmission.reservation.reservationId,
            status: "released",
            outcome: "provider proxy failed to activate",
          });
          await flushSiteFundedCodexOutbox();
          throw err;
        }
        return createTurnRuntime(nextAdmission);
      },
      close: async () => {
        if (runtimeClosed) return;
        runtimeClosed = true;
        if (activeFinish) {
          await activeFinish({
            status: "released",
            outcome: "app-server runtime closed",
          });
        }
        proxySession.close();
      },
    };
  };

  return createTurnRuntime(admission);
}
