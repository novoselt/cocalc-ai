/*
 *  This file is part of CoCalc: Copyright © 2026, SageMath, Inc.
 *  License: MS-RSL – see https://github.com/sagemathinc/cocalc-ai/blob/master/LICENSE.md
 */

import { createServer } from "node:http";
import {
  DEFAULT_SITE_FUNDED_CODEX_POLICY,
  type SiteFundedCodexReservation,
  type SiteFundedCodexUsageEvent,
} from "@cocalc/util/ai/site-funded-codex";
import { uuid } from "@cocalc/util/misc";
import {
  shutdownSiteFundedCodexProxyForTests,
  startSiteFundedCodexProxySession,
} from "./site-funded-proxy";

afterAll(shutdownSiteFundedCodexProxyForTests);

function reservation(): SiteFundedCodexReservation {
  return {
    reservationId: uuid(),
    fundedTurnId: uuid(),
    poolId: "site-funded-codex-free",
    policy: DEFAULT_SITE_FUNDED_CODEX_POLICY,
    reservedMicrousd: DEFAULT_SITE_FUNDED_CODEX_POLICY.maxTurnCostMicrousd,
    committedMicrousd: 0,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    heartbeatIntervalMs: 30_000,
    status: "active",
  };
}

describe("site-funded Codex provider proxy", () => {
  it("forces policy and records streaming usage without exposing the real key", async () => {
    let upstreamAuthorization = "";
    let upstreamBody: any;
    const upstream = createServer(async (request, response) => {
      upstreamAuthorization = `${request.headers.authorization ?? ""}`;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      upstreamBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "x-request-id": "req-header-1",
      });
      response.end(
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp-1",
            usage: {
              input_tokens: 10_000,
              input_tokens_details: { cached_tokens: 6_000 },
              output_tokens: 500,
              output_tokens_details: { reasoning_tokens: 200 },
            },
          },
        })}\n\ndata: [DONE]\n\n`,
      );
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const events: SiteFundedCodexUsageEvent[] = [];
    const session = await startSiteFundedCodexProxySession({
      reservation: reservation(),
      apiKey: "real-site-key",
      upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`,
      onUsage: async (event) => {
        events.push(event);
      },
    });
    const localUrl = session.baseUrl.replace(
      "host.containers.internal",
      "127.0.0.1",
    );
    const result = await fetch(`${localUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        reasoning: { effort: "high" },
        service_tier: "priority",
        tools: [{ type: "function", name: "shell" }],
        input: "hello",
      }),
    });
    expect(result.status).toBe(200);
    await result.text();
    expect(upstreamAuthorization).toBe("Bearer real-site-key");
    expect(upstreamBody).toMatchObject({
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      service_tier: "default",
    });
    expect(upstreamBody.max_output_tokens).toBeGreaterThan(0);
    expect(upstreamBody.max_output_tokens).toBeLessThanOrEqual(8_000);
    expect(events).toEqual([
      expect.objectContaining({
        reservationId: session.reservationId,
        providerRequestId: "resp-1",
        requestSequence: 1,
        model: "gpt-5.6-luna",
        inputTokens: 10_000,
        cachedInputTokens: 6_000,
        outputTokens: 500,
        reasoningOutputTokens: 200,
      }),
    ]);
    session.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("rejects OpenAI-hosted paid tools before forwarding", async () => {
    const session = await startSiteFundedCodexProxySession({
      reservation: reservation(),
      apiKey: "real-site-key",
      upstreamBaseUrl: "http://127.0.0.1:1/v1",
      onUsage: async () => {},
    });
    const localUrl = session.baseUrl.replace(
      "host.containers.internal",
      "127.0.0.1",
    );
    const result = await fetch(`${localUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: "hello",
        tools: [{ type: "web_search_preview" }],
      }),
    });
    expect(result.status).toBe(403);
    await expect(result.json()).resolves.toMatchObject({
      error: { type: "site_funded_codex_policy_error" },
    });
    session.close();
  });
});
