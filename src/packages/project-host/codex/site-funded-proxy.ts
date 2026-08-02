/*
 *  This file is part of CoCalc: Copyright © 2026, SageMath, Inc.
 *  License: MS-RSL – see https://github.com/sagemathinc/cocalc-ai/blob/master/LICENSE.md
 */

import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import getLogger from "@cocalc/backend/logger";
import {
  computeSiteFundedCodexRequestCost,
  type SiteFundedCodexPolicy,
  type SiteFundedCodexReservation,
  type SiteFundedCodexUsageEvent,
} from "@cocalc/util/ai/site-funded-codex";
import { uuid } from "@cocalc/util/misc";

const logger = getLogger("project-host:codex:site-funded-proxy");
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
const DEFAULT_UPSTREAM_BASE_URL = "https://api.openai.com/v1";
const HOSTED_TOOL_TYPES = new Set([
  "code_interpreter",
  "computer_use_preview",
  "file_search",
  "image_generation",
  "web_search",
  "web_search_preview",
]);

type Session = {
  token: string;
  apiKey: string;
  reservation: SiteFundedCodexReservation;
  policy: SiteFundedCodexPolicy;
  upstreamBaseUrl: string;
  startedAt: number;
  requestSequence: number;
  costMicrousd: number;
  closed: boolean;
  blockedReason?: string;
  onUsage: (event: SiteFundedCodexUsageEvent) => Promise<void>;
};

export type SiteFundedProxySession = {
  reservationId: string;
  baseUrl: string;
  token: string;
  policy: SiteFundedCodexPolicy;
  close: () => void;
};

function jsonResponse(
  response: ServerResponse,
  status: number,
  message: string,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      error: {
        message,
        type: "site_funded_codex_policy_error",
      },
    }),
  );
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BODY_BYTES) {
      throw Object.assign(new Error("provider request body is too large"), {
        statusCode: 413,
      });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function usageFromProviderPayload(payload: any): {
  providerRequestId?: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
} | null {
  const response = payload?.response ?? payload;
  const usage = response?.usage;
  if (!usage || typeof usage !== "object") return null;
  const inputDetails =
    usage.input_tokens_details ?? usage.inputTokensDetails ?? {};
  const outputDetails =
    usage.output_tokens_details ?? usage.outputTokensDetails ?? {};
  const number = (value: unknown): number => {
    const parsed = Number(value ?? 0);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  };
  return {
    providerRequestId:
      typeof response?.id === "string" ? response.id : undefined,
    inputTokens: number(usage.input_tokens ?? usage.inputTokens),
    cachedInputTokens: number(
      inputDetails.cached_tokens ??
        inputDetails.cachedTokens ??
        usage.cached_input_tokens,
    ),
    cacheWriteInputTokens: number(
      inputDetails.cache_write_tokens ??
        inputDetails.cacheWriteTokens ??
        usage.cache_write_tokens ??
        usage.cache_write_input_tokens,
    ),
    outputTokens: number(usage.output_tokens ?? usage.outputTokens),
    reasoningOutputTokens: number(
      outputDetails.reasoning_tokens ??
        outputDetails.reasoningTokens ??
        usage.reasoning_output_tokens,
    ),
  };
}

function assertAllowedTools(tools: unknown): void {
  if (!Array.isArray(tools)) return;
  for (const tool of tools) {
    const type = `${(tool as any)?.type ?? ""}`.trim();
    if (HOSTED_TOOL_TYPES.has(type)) {
      throw Object.assign(
        new Error(
          `OpenAI hosted tool '${type}' is not available in site-funded Codex mode`,
        ),
        { statusCode: 403 },
      );
    }
  }
}

function boundedProviderRequest({
  body,
  bodyBytes,
  session,
}: {
  body: any;
  bodyBytes: number;
  session: Session;
}): any {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("provider request must be a JSON object"), {
      statusCode: 400,
    });
  }
  if (session.closed) {
    throw Object.assign(new Error("site-funded Codex turn is closed"), {
      statusCode: 403,
    });
  }
  if (session.blockedReason) {
    throw Object.assign(new Error(session.blockedReason), { statusCode: 403 });
  }
  if (Date.now() - session.startedAt >= session.policy.maxTurnDurationMs) {
    throw Object.assign(
      new Error("site-funded Codex turn reached its duration limit"),
      { statusCode: 403 },
    );
  }
  if (session.requestSequence >= session.policy.maxRequestsPerTurn) {
    throw Object.assign(
      new Error("site-funded Codex turn reached its provider request limit"),
      { statusCode: 403 },
    );
  }
  assertAllowedTools(body.tools);

  // UTF-8 tokens cannot exceed the number of request bytes. JSON overhead
  // makes this a deliberately conservative pre-provider context bound.
  if (bodyBytes > session.policy.maxInputTokensPerRequest) {
    throw Object.assign(
      new Error(
        "This funded request is too large. Start a fresh thread or connect personal OpenAI funding.",
      ),
      { statusCode: 413 },
    );
  }

  const remaining = session.policy.maxTurnCostMicrousd - session.costMicrousd;
  const worstInputCost = computeSiteFundedCodexRequestCost({
    model: session.policy.model,
    usage: {
      inputTokens: bodyBytes,
      cacheWriteInputTokens: bodyBytes,
      outputTokens: 0,
    },
  }).costMicrousd;
  const affordableOutputTokens = Math.floor(
    Math.max(0, remaining - worstInputCost) / 1.2,
  );
  const requestedOutput = Number(body.max_output_tokens);
  const outputLimit = Math.min(
    session.policy.maxOutputTokensPerRequest,
    Number.isSafeInteger(requestedOutput) && requestedOutput > 0
      ? requestedOutput
      : session.policy.maxOutputTokensPerRequest,
    affordableOutputTokens,
  );
  if (outputLimit < 1) {
    throw Object.assign(
      new Error("site-funded Codex turn reached its cost limit"),
      { statusCode: 403 },
    );
  }

  return {
    ...body,
    model: session.policy.model,
    reasoning: {
      ...(body.reasoning && typeof body.reasoning === "object"
        ? body.reasoning
        : {}),
      effort: session.policy.reasoning,
    },
    service_tier: "default",
    max_output_tokens: outputLimit,
  };
}

class SiteFundedCodexProxy {
  private readonly sessions = new Map<string, Session>();
  private server?: ReturnType<typeof createServer>;
  private port?: number;

  private async ensureListening(): Promise<number> {
    if (this.port != null) return this.port;
    if (!this.server) {
      this.server = createServer((request, response) => {
        void this.handle(request, response);
      });
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        this.server?.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        this.server?.off("error", onError);
        resolve();
      };
      this.server!.once("error", onError);
      this.server!.once("listening", onListening);
      this.server!.listen(0, "0.0.0.0");
    });
    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to determine site-funded Codex proxy port");
    }
    this.port = address.port;
    this.server.unref();
    logger.info("site-funded Codex provider proxy listening", {
      port: this.port,
    });
    return this.port;
  }

  async startSession({
    reservation,
    apiKey,
    onUsage,
    upstreamBaseUrl = DEFAULT_UPSTREAM_BASE_URL,
  }: {
    reservation: SiteFundedCodexReservation;
    apiKey: string;
    onUsage: (event: SiteFundedCodexUsageEvent) => Promise<void>;
    upstreamBaseUrl?: string;
  }): Promise<SiteFundedProxySession> {
    const port = await this.ensureListening();
    const token = randomBytes(32).toString("base64url");
    const session: Session = {
      token,
      apiKey,
      reservation,
      policy: reservation.policy,
      upstreamBaseUrl: upstreamBaseUrl.replace(/\/$/, ""),
      startedAt: Date.now(),
      requestSequence: 0,
      costMicrousd: 0,
      closed: false,
      onUsage,
    };
    this.sessions.set(token, session);
    return {
      reservationId: reservation.reservationId,
      baseUrl: `http://host.containers.internal:${port}/v1`,
      token,
      policy: reservation.policy,
      close: () => {
        session.closed = true;
        this.sessions.delete(token);
      },
    };
  }

  async shutdown(): Promise<void> {
    this.sessions.clear();
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private sessionFor(request: IncomingMessage): Session | undefined {
    const authorization = `${request.headers.authorization ?? ""}`;
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    return match ? this.sessions.get(match[1]) : undefined;
  }

  private async recordUsage({
    session,
    requestSequence,
    payload,
    providerRequestId,
    durationMs,
  }: {
    session: Session;
    requestSequence: number;
    payload: any;
    providerRequestId?: string;
    durationMs: number;
  }): Promise<boolean> {
    const usage = usageFromProviderPayload(payload);
    if (!usage) return false;
    const event: SiteFundedCodexUsageEvent = {
      eventId: uuid(),
      reservationId: session.reservation.reservationId,
      providerRequestId: usage.providerRequestId ?? providerRequestId,
      requestSequence,
      model: session.policy.model,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteInputTokens: usage.cacheWriteInputTokens,
      outputTokens: usage.outputTokens,
      reasoningOutputTokens: usage.reasoningOutputTokens,
      durationMs,
    };
    const cost = computeSiteFundedCodexRequestCost({
      model: event.model,
      usage: event,
    });
    session.costMicrousd += cost.costMicrousd;
    if (session.costMicrousd >= session.policy.maxTurnCostMicrousd) {
      session.blockedReason = "site-funded Codex turn reached its cost limit";
    }
    try {
      await session.onUsage(event);
    } catch (err) {
      session.blockedReason =
        "Site-funded usage accounting is temporarily unavailable.";
      logger.error("failed to persist site-funded Codex provider usage", {
        reservationId: session.reservation.reservationId,
        requestSequence,
        err: `${err}`,
      });
    }
    return true;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const session = this.sessionFor(request);
    if (!session) {
      jsonResponse(response, 401, "invalid or expired funded proxy credential");
      return;
    }
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (request.method !== "POST" || requestUrl.pathname !== "/v1/responses") {
      jsonResponse(response, 404, "only POST /v1/responses is supported");
      return;
    }
    const startedAt = Date.now();
    let bodyBuffer: Buffer;
    let body: any;
    try {
      bodyBuffer = await readBody(request);
      body = boundedProviderRequest({
        body: JSON.parse(bodyBuffer.toString("utf8")),
        bodyBytes: bodyBuffer.length,
        session,
      });
    } catch (err: any) {
      jsonResponse(response, err?.statusCode ?? 400, `${err?.message ?? err}`);
      return;
    }

    session.requestSequence += 1;
    const requestSequence = session.requestSequence;
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (
        value == null ||
        ["authorization", "connection", "content-length", "host"].includes(
          name.toLowerCase(),
        )
      ) {
        continue;
      }
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    headers.set("authorization", `Bearer ${session.apiKey}`);
    headers.set("content-type", "application/json");

    let upstream: Response;
    try {
      upstream = await fetch(`${session.upstreamBaseUrl}/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      jsonResponse(response, 502, `OpenAI request failed: ${err}`);
      return;
    }
    const responseHeaders: Record<string, string> = {};
    upstream.headers.forEach((value, name) => {
      if (
        !["content-encoding", "content-length", "transfer-encoding"].includes(
          name,
        )
      ) {
        responseHeaders[name] = value;
      }
    });
    response.writeHead(upstream.status, responseHeaders);
    const providerRequestId = upstream.headers.get("x-request-id") ?? undefined;
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.body) {
      response.end();
      session.blockedReason = "OpenAI response did not include usage data.";
      return;
    }

    if (!contentType.includes("text/event-stream")) {
      const text = await upstream.text();
      response.end(text);
      try {
        const recorded = await this.recordUsage({
          session,
          requestSequence,
          payload: JSON.parse(text),
          providerRequestId,
          durationMs: Date.now() - startedAt,
        });
        if (!recorded) {
          session.blockedReason = "OpenAI response did not include usage data.";
        }
      } catch (err) {
        session.blockedReason = `Invalid OpenAI usage response: ${err}`;
      }
      return;
    }

    const decoder = new TextDecoder();
    let pending = "";
    let usageRecorded = false;
    try {
      for await (const chunk of upstream.body as any) {
        const buffer = Buffer.from(chunk);
        response.write(buffer);
        pending += decoder.decode(buffer, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const payload = JSON.parse(data);
            if (
              !usageRecorded &&
              (payload.type === "response.completed" ||
                payload.type === "response.incomplete" ||
                payload.type === "response.failed")
            ) {
              usageRecorded = await this.recordUsage({
                session,
                requestSequence,
                payload,
                providerRequestId,
                durationMs: Date.now() - startedAt,
              });
            }
          } catch {
            // Ignore non-JSON SSE comments and partial diagnostic events.
          }
        }
      }
    } finally {
      response.end();
    }
    if (!usageRecorded) {
      session.blockedReason = "OpenAI response did not include usage data.";
    }
  }
}

const proxy = new SiteFundedCodexProxy();

export async function startSiteFundedCodexProxySession(
  opts: Parameters<SiteFundedCodexProxy["startSession"]>[0],
): Promise<SiteFundedProxySession> {
  return await proxy.startSession(opts);
}

export async function shutdownSiteFundedCodexProxyForTests(): Promise<void> {
  await proxy.shutdown();
}
