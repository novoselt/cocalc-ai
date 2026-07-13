/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createHash } from "crypto";
import type {
  Ticket,
  TicketComment,
} from "node-zendesk/dist/types/clients/core/tickets";

import getLogger from "@cocalc/backend/logger";
import type {
  AdminSupportCategory,
  AdminSupportListRequest,
  AdminSupportListResponse,
  AdminSupportShowRequest,
  AdminSupportShowResponse,
  AdminSupportTicketComment,
  AdminSupportTicketSignals,
  AdminSupportTicketStatus,
  AdminSupportTicketSummary,
  AdminSupportTriageGroup,
  AdminSupportTriageRequest,
  AdminSupportTriageResponse,
} from "@cocalc/conat/hub/api/admin-support";
import { ADMIN_SUPPORT_TICKET_STATUSES } from "@cocalc/conat/hub/api/admin-support";
import centralLog from "@cocalc/database/postgres/central-log";
import isAdmin from "@cocalc/server/accounts/is-admin";
import getZendeskClient from "@cocalc/server/support/zendesk-client";
import { isValidUUID, uuid } from "@cocalc/util/misc";

const logger = getLogger("server:conat:api:admin-support");

const DEFAULT_SINCE_MINUTES = 24 * 60;
const MAX_SINCE_MINUTES = 7 * 24 * 60;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_MAX_BYTES = 1024 * 1024;
const MIN_MAX_BYTES = 16 * 1024;
const DEFAULT_MAX_COMMENTS = 50;
const MAX_MAX_COMMENTS = 100;
const MAX_REASON_LENGTH = 500;
const MAX_SUBJECT_CHARS = 500;
const MAX_PREVIEW_CHARS = 2_000;
const MAX_DESCRIPTION_CHARS = 50_000;
const MAX_COMMENT_CHARS = 20_000;
const ZENDESK_TIMEOUT_MS = 20_000;
const DEFAULT_STATUSES: AdminSupportTicketStatus[] = [
  "new",
  "open",
  "pending",
  "hold",
];

type AuthOpts = { account_id?: string };
type ZendeskSearchResult = { response: unknown; result: Ticket[] };
type ZendeskShowResult = { response: unknown; result: Ticket };
type ZendeskCommentsResult = { response: unknown; result: TicketComment[] };

let activeZendeskReads = 0;
const MAX_ACTIVE_ZENDESK_READS = 2;

function positiveInt({
  value,
  fallback,
  max,
}: {
  value?: number;
  fallback: number;
  max: number;
}): number {
  const n = Math.floor(Number(value ?? fallback));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

function requiredReason(value: unknown): string {
  const reason = `${value ?? ""}`.trim();
  if (!reason) {
    throw new Error("a human-readable audit reason is required");
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new Error(`audit reason must be at most ${MAX_REASON_LENGTH} chars`);
  }
  return reason;
}

async function requireAdmin({ account_id }: AuthOpts): Promise<string> {
  const accountId = `${account_id ?? ""}`.trim();
  if (!accountId) throw new Error("must be signed in");
  if (!(await isAdmin(accountId))) {
    throw Object.assign(new Error("admin privileges required"), { code: 403 });
  }
  return accountId;
}

function normalizeStatuses(
  values: AdminSupportTicketStatus[] | undefined,
): AdminSupportTicketStatus[] {
  if (values == null || values.length === 0) return [...DEFAULT_STATUSES];
  const allowed = new Set<string>(ADMIN_SUPPORT_TICKET_STATUSES);
  const statuses = [...new Set(values.map((value) => `${value}`.trim()))];
  for (const status of statuses) {
    if (!allowed.has(status)) {
      throw new Error(
        `invalid support status '${status}'; expected one of ${ADMIN_SUPPORT_TICKET_STATUSES.join(", ")}`,
      );
    }
  }
  return statuses as AdminSupportTicketStatus[];
}

function hashFingerprint(namespace: string, value: string): string {
  return `${namespace}_${createHash("sha256")
    .update(`${namespace}\0${value}`)
    .digest("hex")
    .slice(0, 16)}`;
}

function sanitizeUrl(raw: string): string {
  const trailing = raw.match(/[.,;:!?)]*$/)?.[0] ?? "";
  const value = trailing ? raw.slice(0, -trailing.length) : raw;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.hash = "";
    if (url.search) url.search = "?REDACTED";
    const projectMatch = url.pathname.match(
      /^(.*\/projects\/[0-9a-f-]{36})(?:\/.*)?$/i,
    );
    if (projectMatch) url.pathname = `${projectMatch[1]}/[REDACTED_PATH]`;
    return `${url.toString()}${trailing}`;
  } catch {
    return `[REDACTED_URL]${trailing}`;
  }
}

export function redactSupportText(value: unknown, maxChars: number): string {
  let text = `${value ?? ""}`;
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, sanitizeUrl);
  text = text.replace(
    /\b(account[_ -]?id)\s*[:=]\s*["']?[0-9a-f-]{36}["']?/gi,
    "$1=[REDACTED_ACCOUNT_ID]",
  );
  text = text.replace(
    /\b(authorization|api[_ -]?key|access[_ -]?token|password|passwd|secret)\b\s*[:=]\s*[^\s,;]+/gi,
    "$1=[REDACTED_SECRET]",
  );
  text = text.replace(
    /\b[A-Z][A-Z0-9+/_-]*\.[A-Z0-9+/_-]+\.[A-Z0-9+/_-]+\b/gi,
    "[REDACTED_TOKEN]",
  );
  text = text.replace(
    /\b(?:sk|rk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g,
    "[REDACTED_TOKEN]",
  );
  text = text.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[REDACTED_EMAIL]",
  );
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]");
  text = text.replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED_NUMBER]");
  if (text.length > maxChars) {
    return `${text.slice(0, Math.max(0, maxChars - 20))}\n[TRUNCATED]`;
  }
  return text;
}

function projectIdsFromText(value: unknown): string[] {
  const ids = new Set<string>();
  const text = `${value ?? ""}`;
  const pattern = /\/projects\/([0-9a-f-]{36})(?:\/|\b)/gi;
  for (const match of text.matchAll(pattern)) {
    const projectId = `${match[1] ?? ""}`.toLowerCase();
    if (isValidUUID(projectId)) ids.add(projectId);
  }
  return [...ids].slice(0, 20);
}

const CATEGORY_PATTERNS: Array<[AdminSupportCategory, RegExp]> = [
  [
    "availability",
    /\b(down|offline|outage|unavailable|not responding|502|503|504|disconnected)\b/i,
  ],
  ["performance", /\b(slow|latency|lag|hanging|unresponsive|timeout)\b/i],
  [
    "project_start",
    /\b(project (?:will not|won't|does not|doesn't|cannot|can't) start|start(?:ing)? project|stuck (?:starting|loading))\b/i,
  ],
  ["files", /\b(file listing|files? (?:missing|not showing)|file server)\b/i],
  ["terminal", /\b(terminal|shell command|console)\b/i],
  ["codex", /\b(codex|acp-worker|acp worker|ai assistant|agent turn)\b/i],
  ["jupyter", /\b(jupyter|notebook|kernel)\b/i],
  [
    "billing",
    /\b(billing|invoice|payment|purchase|subscription|membership|credit card|refund|charge)\b/i,
  ],
  [
    "account_access",
    /\b(login|log in|sign in|password|account access|two-factor|2fa|verification email)\b/i,
  ],
  [
    "abuse_security",
    /\b(abuse|security|hacked|compromised|phishing|spam|crypto ?mining|malware)\b/i,
  ],
  ["bug", /\b(bug|exception|traceback|stack trace|error|broken|regression)\b/i],
  [
    "how_to",
    /\b(how (?:do|can|to)|is it possible|where can|documentation|help me)\b/i,
  ],
];

const ERROR_SIGNATURES: Array<[string, RegExp]> = [
  ["ENOSPC", /\bENOSPC\b|no space left on device/i],
  ["SQLITE_FULL", /\bSQLITE_FULL\b/i],
  ["SQLITE_IOERR", /\bSQLITE_IOERR\b|disk I\/O error/i],
  ["ECONNRESET", /\bECONNRESET\b|connection reset/i],
  ["ETIMEDOUT", /\bETIMEDOUT\b|timed out/i],
  ["MODULE_NOT_FOUND", /\bMODULE_NOT_FOUND\b|cannot find module/i],
  ["FILE_SERVER_NOT_INITIALIZED", /file server not initialized/i],
  ["WEBSOCKET_ERROR", /websocket (?:connection )?(?:failed|error)/i],
  ["PERMISSION_DENIED", /permission denied/i],
  ["OUT_OF_MEMORY", /out of memory|oom[- ]kill/i],
  ["HTTP_5XX", /\b(?:500|502|503|504)\b/],
];

export function deriveSupportSignals(
  value: unknown,
): AdminSupportTicketSignals {
  const text = `${value ?? ""}`;
  const categories = CATEGORY_PATTERNS.filter(([, pattern]) =>
    pattern.test(text),
  ).map(([category]) => category);
  return {
    categories: categories.length > 0 ? categories : ["other"],
    error_signatures: ERROR_SIGNATURES.filter(([, pattern]) =>
      pattern.test(text),
    ).map(([signature]) => signature),
  };
}

function safeDate(value: unknown): string {
  const date = new Date(`${value ?? ""}`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function agentUrl(ticket: Ticket): string {
  try {
    return `${new URL(ticket.url).origin}/agent/tickets/${ticket.id}`;
  } catch {
    return `ticket:${ticket.id}`;
  }
}

function summarizeTicket(ticket: Ticket): AdminSupportTicketSummary {
  const sourceText = `${ticket.subject ?? ""}\n${ticket.description ?? ""}`;
  const externalId = `${ticket.external_id ?? ""}`.trim();
  const status = ADMIN_SUPPORT_TICKET_STATUSES.includes(ticket.status as any)
    ? (ticket.status as AdminSupportTicketStatus)
    : "unknown";
  return {
    id: Number(ticket.id),
    agent_url: agentUrl(ticket),
    status,
    ...(ticket.type ? { type: `${ticket.type}` } : {}),
    ...(ticket.priority ? { priority: `${ticket.priority}` } : {}),
    subject: redactSupportText(ticket.subject, MAX_SUBJECT_CHARS),
    description_preview: redactSupportText(
      ticket.description,
      MAX_PREVIEW_CHARS,
    ),
    created_at: safeDate(ticket.created_at),
    updated_at: safeDate(ticket.updated_at),
    ...(externalId
      ? { account_fingerprint: hashFingerprint("account", externalId) }
      : {}),
    project_ids: projectIdsFromText(sourceText),
    signals: deriveSupportSignals(sourceText),
  };
}

function normalizeTicketComment(
  comment: TicketComment,
  requesterId: number,
): AdminSupportTicketComment {
  const attachments = Array.isArray(comment.attachments)
    ? comment.attachments
    : [];
  return {
    id: Number(comment.id),
    author:
      Number(comment.author_id) === requesterId
        ? "requester"
        : "staff_or_system",
    public: !!comment.public,
    created_at: safeDate(comment.created_at),
    body: redactSupportText(
      comment.plain_body || comment.body,
      MAX_COMMENT_CHARS,
    ),
    attachment_count: attachments.length,
    attachment_bytes: attachments.reduce(
      (sum, attachment) => sum + (Number(attachment?.size) || 0),
      0,
    ),
  };
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function limitItemsByBytes<T>({
  items,
  maxBytes,
  envelopeBytes,
}: {
  items: T[];
  maxBytes: number;
  envelopeBytes: number;
}): { items: T[]; bytes: number; truncated: boolean } {
  const selected: T[] = [];
  let bytes = envelopeBytes;
  for (const item of items) {
    const itemBytes = serializedBytes(item) + 1;
    if (bytes + itemBytes > maxBytes) {
      return { items: selected, bytes, truncated: true };
    }
    selected.push(item);
    bytes += itemBytes;
  }
  return { items: selected, bytes, truncated: false };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`${label} timed out after ${ZENDESK_TIMEOUT_MS}ms`),
            ),
          ZENDESK_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

async function withZendeskReadSlot<T>(
  fn: () => Promise<T>,
  timeoutLabel: string,
): Promise<T> {
  if (activeZendeskReads >= MAX_ACTIVE_ZENDESK_READS) {
    throw Object.assign(
      new Error("support diagnostics are busy; retry later"),
      {
        code: 503,
      },
    );
  }
  activeZendeskReads += 1;
  const operation = fn();
  const release = () => {
    activeZendeskReads -= 1;
  };
  void operation.then(release, release);
  return await withTimeout(operation, timeoutLabel);
}

async function searchRecentTickets(since: Date): Promise<Ticket[]> {
  const client = await getZendeskClient();
  const query = `type:ticket created>=${since.toISOString().slice(0, 10)}`;
  const response = (await client.search.get([
    "search",
    { query, sort_by: "updated_at", sort_order: "desc" },
  ])) as unknown as ZendeskSearchResult;
  return Array.isArray(response?.result) ? response.result : [];
}

async function loadTicket(ticketId: number): Promise<{
  ticket: Ticket;
  comments: TicketComment[];
}> {
  const client = await getZendeskClient();
  const [ticketResponse, commentResponse] = await Promise.all([
    client.tickets.show(ticketId) as Promise<ZendeskShowResult>,
    client.tickets.get([
      "tickets",
      ticketId,
      "comments",
      { sort_order: "desc" },
    ]) as unknown as Promise<ZendeskCommentsResult>,
  ]);
  if (!ticketResponse?.result) throw new Error(`ticket ${ticketId} not found`);
  return {
    ticket: ticketResponse.result,
    comments: Array.isArray(commentResponse?.result)
      ? commentResponse.result
      : [],
  };
}

async function recordAudit({
  auditId,
  accountId,
  mode,
  reason,
  ticketId,
  sinceMinutes,
  statuses,
  resultCount,
  resultBytes,
  truncated,
  durationMs,
  error,
}: {
  auditId: string;
  accountId: string;
  mode: "list" | "show" | "triage";
  reason: string;
  ticketId?: number;
  sinceMinutes?: number;
  statuses?: AdminSupportTicketStatus[];
  resultCount?: number;
  resultBytes?: number;
  truncated?: boolean;
  durationMs: number;
  error?: unknown;
}): Promise<void> {
  try {
    await centralLog({
      event: "admin_support_operator",
      value: {
        audit_id: auditId,
        account_id: accountId,
        mode,
        reason,
        ticket_id: ticketId ?? null,
        since_minutes: sinceMinutes ?? null,
        statuses: statuses ?? null,
        result_count: resultCount ?? null,
        result_bytes: resultBytes ?? null,
        truncated: truncated ?? null,
        duration_ms: durationMs,
        error: error == null ? null : `${error}`,
      },
    });
  } catch (err) {
    logger.warn("failed to write admin support audit event", {
      audit_id: auditId,
      err,
    });
  }
}

async function listTicketsInternal({
  sinceMinutes,
  limit,
  statuses,
  maxBytes,
}: {
  sinceMinutes: number;
  limit: number;
  statuses: AdminSupportTicketStatus[];
  maxBytes: number;
}): Promise<Omit<AdminSupportListResponse, "audit_id">> {
  const since = new Date(Date.now() - sinceMinutes * 60_000);
  const source = await withZendeskReadSlot(
    () => searchRecentTickets(since),
    "Zendesk ticket search",
  );
  const statusSet = new Set(statuses);
  const filtered = source
    .filter((ticket) => {
      const createdAt = new Date(ticket.created_at).getTime();
      return (
        Number.isFinite(createdAt) &&
        createdAt >= since.getTime() &&
        statusSet.has(ticket.status as AdminSupportTicketStatus)
      );
    })
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    .slice(0, limit)
    .map(summarizeTicket);
  const envelope = {
    server_time: new Date().toISOString(),
    since: since.toISOString(),
    statuses,
    source_candidates: source.length,
    redaction: "best_effort" as const,
  };
  const bounded = limitItemsByBytes({
    items: filtered,
    maxBytes,
    envelopeBytes: serializedBytes(envelope),
  });
  return {
    ...envelope,
    tickets: bounded.items,
    result_bytes: bounded.bytes,
    truncated:
      bounded.truncated || filtered.length >= limit || source.length >= 100,
  };
}

export async function list(
  opts: AdminSupportListRequest & AuthOpts,
): Promise<AdminSupportListResponse> {
  const started = Date.now();
  const auditId = uuid();
  const accountId = await requireAdmin(opts);
  const reason = requiredReason(opts.reason);
  const sinceMinutes = positiveInt({
    value: opts.since_minutes,
    fallback: DEFAULT_SINCE_MINUTES,
    max: MAX_SINCE_MINUTES,
  });
  const limit = positiveInt({
    value: opts.limit,
    fallback: DEFAULT_LIMIT,
    max: MAX_LIMIT,
  });
  const maxBytes = Math.max(
    MIN_MAX_BYTES,
    positiveInt({
      value: opts.max_bytes,
      fallback: DEFAULT_MAX_BYTES,
      max: MAX_MAX_BYTES,
    }),
  );
  const statuses = normalizeStatuses(opts.statuses);
  try {
    const result = await listTicketsInternal({
      sinceMinutes,
      limit,
      statuses,
      maxBytes,
    });
    await recordAudit({
      auditId,
      accountId,
      mode: "list",
      reason,
      sinceMinutes,
      statuses,
      resultCount: result.tickets.length,
      resultBytes: result.result_bytes,
      truncated: result.truncated,
      durationMs: Date.now() - started,
    });
    return { audit_id: auditId, ...result };
  } catch (error) {
    await recordAudit({
      auditId,
      accountId,
      mode: "list",
      reason,
      sinceMinutes,
      statuses,
      durationMs: Date.now() - started,
      error,
    });
    throw error;
  }
}

export async function show(
  opts: AdminSupportShowRequest & AuthOpts,
): Promise<AdminSupportShowResponse> {
  const started = Date.now();
  const auditId = uuid();
  const accountId = await requireAdmin(opts);
  const reason = requiredReason(opts.reason);
  const ticketId = Math.floor(Number(opts.ticket_id));
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
    throw new Error("ticket_id must be a positive integer");
  }
  const maxComments = positiveInt({
    value: opts.max_comments,
    fallback: DEFAULT_MAX_COMMENTS,
    max: MAX_MAX_COMMENTS,
  });
  const maxBytes = Math.max(
    MIN_MAX_BYTES,
    positiveInt({
      value: opts.max_bytes,
      fallback: DEFAULT_MAX_BYTES,
      max: MAX_MAX_BYTES,
    }),
  );
  try {
    const { ticket, comments: rawComments } = await withZendeskReadSlot(
      () => loadTicket(ticketId),
      "Zendesk ticket and comments read",
    );
    const summary = summarizeTicket(ticket);
    const ticketDetail = {
      ...summary,
      description: redactSupportText(
        ticket.description,
        Math.min(MAX_DESCRIPTION_CHARS, Math.floor(maxBytes / 2)),
      ),
    };
    const comments = rawComments
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )
      .slice(-maxComments)
      .map((comment) => normalizeTicketComment(comment, ticket.requester_id));
    const envelope = {
      server_time: new Date().toISOString(),
      ticket: ticketDetail,
      redaction: "best_effort" as const,
    };
    const bounded = limitItemsByBytes({
      items: comments,
      maxBytes,
      envelopeBytes: serializedBytes(envelope),
    });
    const result: AdminSupportShowResponse = {
      audit_id: auditId,
      ...envelope,
      comments: bounded.items,
      result_bytes: bounded.bytes,
      truncated:
        bounded.truncated ||
        rawComments.length > maxComments ||
        rawComments.length >= 100,
    };
    await recordAudit({
      auditId,
      accountId,
      mode: "show",
      reason,
      ticketId,
      resultCount: result.comments.length,
      resultBytes: result.result_bytes,
      truncated: result.truncated,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    await recordAudit({
      auditId,
      accountId,
      mode: "show",
      reason,
      ticketId,
      durationMs: Date.now() - started,
      error,
    });
    throw error;
  }
}

const SUBJECT_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "cannot",
  "cocalc",
  "could",
  "does",
  "from",
  "have",
  "help",
  "please",
  "project",
  "support",
  "that",
  "this",
  "with",
  "would",
]);

function subjectSimilarityKey(subject: string): string | undefined {
  const tokens = subject
    .toLowerCase()
    .replace(/\[[^\]]+]/g, " ")
    .match(/[a-z0-9_]{3,}/g);
  if (!tokens) return undefined;
  const normalized = [
    ...new Set(tokens.filter((x) => !SUBJECT_STOP_WORDS.has(x))),
  ]
    .sort()
    .slice(0, 8);
  return normalized.length >= 2 ? normalized.join("-") : undefined;
}

function groupTicket(ticket: AdminSupportTicketSummary): {
  key: string;
  reason: AdminSupportTriageGroup["reason"];
  category: AdminSupportCategory;
} {
  const category = ticket.signals.categories[0] ?? "other";
  const error = ticket.signals.error_signatures[0];
  if (error) {
    return { key: `error:${error}`, reason: "error_signature", category };
  }
  const subjectKey = subjectSimilarityKey(ticket.subject);
  if (subjectKey) {
    return {
      key: `subject:${subjectKey}`,
      reason: "subject_similarity",
      category,
    };
  }
  return { key: `category:${category}`, reason: "category", category };
}

export function buildTriageGroups(
  tickets: AdminSupportTicketSummary[],
): AdminSupportTriageGroup[] {
  const groups = new Map<string, AdminSupportTriageGroup>();
  for (const ticket of tickets) {
    const grouping = groupTicket(ticket);
    const group = groups.get(grouping.key) ?? {
      ...grouping,
      ticket_ids: [],
      count: 0,
      first_created_at: ticket.created_at,
      last_updated_at: ticket.updated_at,
      project_ids: [],
      error_signatures: [],
      subjects: [],
    };
    group.ticket_ids.push(ticket.id);
    group.count += 1;
    group.first_created_at = [group.first_created_at, ticket.created_at]
      .filter(Boolean)
      .sort()[0];
    group.last_updated_at = [group.last_updated_at, ticket.updated_at]
      .filter(Boolean)
      .sort()
      .at(-1)!;
    group.project_ids = [
      ...new Set([...group.project_ids, ...ticket.project_ids]),
    ].slice(0, 20);
    group.error_signatures = [
      ...new Set([
        ...group.error_signatures,
        ...ticket.signals.error_signatures,
      ]),
    ];
    group.subjects = [...new Set([...group.subjects, ticket.subject])].slice(
      0,
      10,
    );
    groups.set(grouping.key, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.count - a.count || b.last_updated_at.localeCompare(a.last_updated_at),
  );
}

export async function triage(
  opts: AdminSupportTriageRequest & AuthOpts,
): Promise<AdminSupportTriageResponse> {
  const started = Date.now();
  const auditId = uuid();
  const accountId = await requireAdmin(opts);
  const reason = requiredReason(opts.reason);
  const sinceMinutes = positiveInt({
    value: opts.since_minutes,
    fallback: DEFAULT_SINCE_MINUTES,
    max: MAX_SINCE_MINUTES,
  });
  const limit = positiveInt({
    value: opts.limit,
    fallback: DEFAULT_LIMIT,
    max: MAX_LIMIT,
  });
  const maxBytes = Math.max(
    MIN_MAX_BYTES,
    positiveInt({
      value: opts.max_bytes,
      fallback: DEFAULT_MAX_BYTES,
      max: MAX_MAX_BYTES,
    }),
  );
  const statuses = normalizeStatuses(opts.statuses);
  try {
    const listed = await listTicketsInternal({
      sinceMinutes,
      limit,
      statuses,
      maxBytes,
    });
    const tickets = [...listed.tickets];
    let result: AdminSupportTriageResponse;
    while (true) {
      const categoryCounts: Partial<Record<AdminSupportCategory, number>> = {};
      for (const ticket of tickets) {
        for (const category of ticket.signals.categories) {
          categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
        }
      }
      result = {
        audit_id: auditId,
        ...listed,
        tickets,
        category_counts: categoryCounts,
        groups: buildTriageGroups(tickets),
        truncated: listed.truncated || tickets.length < listed.tickets.length,
      };
      result.result_bytes = serializedBytes(result);
      if (result.result_bytes <= maxBytes || tickets.length === 0) break;
      tickets.pop();
    }
    await recordAudit({
      auditId,
      accountId,
      mode: "triage",
      reason,
      sinceMinutes,
      statuses,
      resultCount: result.tickets.length,
      resultBytes: result.result_bytes,
      truncated: result.truncated,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    await recordAudit({
      auditId,
      accountId,
      mode: "triage",
      reason,
      sinceMinutes,
      statuses,
      durationMs: Date.now() - started,
      error,
    });
    throw error;
  }
}
