/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { probeProjectHostPublicRoute } from "./public-route-probe";

const PUBLIC_URL = "https://host-123-cocalc-prod.cocalc.ai";
const ORIGIN = "https://cocalc.ai";

function response(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, { status, headers });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

describe("probeProjectHostPublicRoute", () => {
  it("checks public health, CORS preflight, and session rejection", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        response(200, { server: "cloudflare", "cf-ray": "ray-1" }),
      )
      .mockResolvedValueOnce(response(204, corsHeaders()))
      .mockResolvedValueOnce(response(401, corsHeaders()));

    await expect(
      probeProjectHostPublicRoute({
        public_url: `${PUBLIC_URL}/ignored/path`,
        origin: ORIGIN,
        fetchImpl,
        timeout_ms: 1000,
      }),
    ).resolves.toEqual({
      public_url: PUBLIC_URL,
      origin: ORIGIN,
      health_status: 200,
      preflight_status: 204,
      session_status: 401,
      edge_server: "cloudflare",
      cf_ray: "ray-1",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(`${fetchImpl.mock.calls[0][0]}`).toBe(`${PUBLIC_URL}/healthz`);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET" });
    expect(`${fetchImpl.mock.calls[1][0]}`).toBe(
      `${PUBLIC_URL}/.cocalc/project-host/session`,
    );
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      method: "OPTIONS",
      headers: expect.objectContaining({
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
      }),
    });
    expect(fetchImpl.mock.calls[2][1]).toMatchObject({
      method: "POST",
      body: "{}",
    });
  });

  it("rejects a public edge response without browser CORS headers", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(
        response(204, {
          ...corsHeaders(),
          "Access-Control-Allow-Origin": "",
        }),
      );

    await expect(
      probeProjectHostPublicRoute({
        public_url: PUBLIC_URL,
        origin: ORIGIN,
        fetchImpl,
      }),
    ).rejects.toThrow("invalid Access-Control-Allow-Origin");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a Cloudflare or origin health error before session checks", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(502));

    await expect(
      probeProjectHostPublicRoute({
        public_url: PUBLIC_URL,
        origin: ORIGIN,
        fetchImpl,
      }),
    ).rejects.toThrow("health check returned HTTP 502");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("requires the exact unauthenticated session response", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(204, corsHeaders()))
      .mockResolvedValueOnce(response(403, corsHeaders()));

    await expect(
      probeProjectHostPublicRoute({
        public_url: PUBLIC_URL,
        origin: ORIGIN,
        fetchImpl,
      }),
    ).rejects.toThrow("returned HTTP 403; expected 401");
  });

  it("rejects credentials embedded in the public URL", async () => {
    await expect(
      probeProjectHostPublicRoute({
        public_url: "https://user:secret@host.example.test",
        origin: ORIGIN,
        fetchImpl: jest.fn(),
      }),
    ).rejects.toThrow("must not contain credentials");
  });
});
