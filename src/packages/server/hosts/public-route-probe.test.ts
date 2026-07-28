/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { createHash } from "node:crypto";
import { createServer } from "node:http";

import {
  _test,
  probeProjectHostPublicRoute,
  projectHostPublicRouteProbeDiagnostic,
} from "./public-route-probe";

const PUBLIC_URL = "https://host-123-cocalc-prod.cocalc.ai";
const ORIGIN = "https://cocalc.ai";
const HOST_ID = "84f2a969-6d8e-4a47-93c5-7cc13cf13ac0";

function response(
  status: number,
  headers: Record<string, string> = {},
  body: BodyInit | null = null,
): Response {
  return new Response(body, { status, headers });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

function healthResponse({
  body = {},
  headers = {},
}: {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
} = {}): Response {
  return response(
    200,
    { "content-type": "application/json", ...headers },
    JSON.stringify({
      ok: true,
      ready: true,
      host_id: HOST_ID,
      ...body,
    }),
  );
}

describe("probeProjectHostPublicRoute", () => {
  it("checks public health, CORS preflight, and session rejection", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        healthResponse({
          headers: { server: "cloudflare", "cf-ray": "ray-1" },
        }),
      )
      .mockResolvedValueOnce(response(204, corsHeaders()))
      .mockResolvedValueOnce(response(401, corsHeaders()));
    const websocketProbeImpl = jest.fn().mockResolvedValue({ status: 101 });

    await expect(
      probeProjectHostPublicRoute({
        public_url: `${PUBLIC_URL}/ignored/path`,
        origin: ORIGIN,
        expected_host_id: HOST_ID,
        fetchImpl,
        websocketProbeImpl,
        timeout_ms: 1000,
      }),
    ).resolves.toEqual({
      public_url: PUBLIC_URL,
      origin: ORIGIN,
      expected_host_id: HOST_ID,
      health_host_id: HOST_ID,
      health_status: 200,
      preflight_status: 204,
      session_status: 401,
      websocket_status: 101,
      websocket_attempts: 8,
      websocket_successes: 8,
      websocket_failures: 0,
      websocket_samples: Array.from({ length: 8 }, () => ({
        ok: true,
        duration_ms: expect.any(Number),
        status: 101,
      })),
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
    expect(websocketProbeImpl).toHaveBeenCalledTimes(8);
    expect(websocketProbeImpl).toHaveBeenCalledWith({
      url: new URL(`${PUBLIC_URL}/conat/?EIO=4&transport=websocket`),
      origin: ORIGIN,
      timeout_ms: 1000,
    });
  });

  it("tolerates a minority of sampled WebSocket upgrade failures", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(healthResponse())
      .mockResolvedValueOnce(response(204, corsHeaders()))
      .mockResolvedValueOnce(response(401, corsHeaders()));
    const websocketProbeImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error("first websocket error"))
      .mockResolvedValue({ status: 101 });

    await expect(
      probeProjectHostPublicRoute({
        public_url: PUBLIC_URL,
        origin: ORIGIN,
        expected_host_id: HOST_ID,
        fetchImpl,
        websocketProbeImpl,
        websocket_attempts: 4,
      }),
    ).resolves.toMatchObject({
      websocket_attempts: 4,
      websocket_successes: 3,
      websocket_failures: 1,
      websocket_status: 101,
      websocket_samples: [
        expect.objectContaining({
          ok: false,
          error: "Error: first websocket error",
        }),
        expect.objectContaining({ ok: true, status: 101 }),
        expect.objectContaining({ ok: true, status: 101 }),
        expect.objectContaining({ ok: true, status: 101 }),
      ],
    });
  });

  it("fails when fewer than 75 percent of WebSocket upgrades succeed", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(healthResponse())
      .mockResolvedValueOnce(response(204, corsHeaders()))
      .mockResolvedValueOnce(response(401, corsHeaders()));
    const websocketProbeImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error("first websocket error"))
      .mockRejectedValueOnce(new Error("second websocket error"))
      .mockResolvedValue({ status: 101 });

    await expect(
      probeProjectHostPublicRoute({
        public_url: PUBLIC_URL,
        origin: ORIGIN,
        expected_host_id: HOST_ID,
        fetchImpl,
        websocketProbeImpl,
        websocket_attempts: 4,
      }),
    ).rejects.toThrow(
      "2/4 public project-host WebSocket upgrades failed: Error: first websocket error",
    );
  });

  it("uses isolated native HTTP requests for the default transport", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ ok: true, ready: true, host_id: HOST_ID }),
        );
        return;
      }
      if (
        request.url === "/.cocalc/project-host/session" &&
        request.method === "OPTIONS"
      ) {
        response.writeHead(204, corsHeaders());
        response.end();
        return;
      }
      if (
        request.url === "/.cocalc/project-host/session" &&
        request.method === "POST"
      ) {
        response.writeHead(401, corsHeaders());
        response.end();
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("test server did not bind a TCP port");
      }
      await expect(
        probeProjectHostPublicRoute({
          public_url: `http://127.0.0.1:${address.port}`,
          origin: ORIGIN,
          expected_host_id: HOST_ID,
          websocketProbeImpl: jest.fn().mockResolvedValue({ status: 101 }),
          websocket_attempts: 4,
          timeout_ms: 1000,
        }),
      ).resolves.toMatchObject({
        health_status: 200,
        preflight_status: 204,
        session_status: 401,
        websocket_successes: 4,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("performs and validates a raw WebSocket upgrade", async () => {
    const server = createServer();
    server.on("upgrade", (request, socket) => {
      const key = `${request.headers["sec-websocket-key"] ?? ""}`;
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.end(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Connection: Upgrade",
          "Upgrade: websocket",
          `Sec-WebSocket-Accept: ${accept}`,
          "CF-Ray: local-ray",
          "",
          "",
        ].join("\r\n"),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("test server did not bind a TCP port");
      }
      await expect(
        _test.probeWebSocketUpgrade({
          url: new URL(
            `http://127.0.0.1:${address.port}/conat/?EIO=4&transport=websocket`,
          ),
          origin: ORIGIN,
          timeout_ms: 1000,
        }),
      ).resolves.toEqual({ status: 101, cf_ray: "local-ray" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("retains HTTP status and CF-Ray for failed WebSocket samples", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(520, { "CF-Ray": "failed-ray-DFW" });
      response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("test server did not bind a TCP port");
      }
      const localUrl = `http://127.0.0.1:${address.port}`;
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce(healthResponse())
        .mockResolvedValueOnce(response(204, corsHeaders()))
        .mockResolvedValueOnce(response(401, corsHeaders()));
      let caught: unknown;
      try {
        await probeProjectHostPublicRoute({
          public_url: localUrl,
          origin: ORIGIN,
          expected_host_id: HOST_ID,
          fetchImpl,
          websocket_attempts: 4,
          timeout_ms: 1000,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(projectHostPublicRouteProbeDiagnostic(caught)).toMatchObject({
        stage: "websocket",
        websocket_attempts: 4,
        websocket_successes: 0,
        websocket_failures: 4,
        websocket_samples: Array.from({ length: 4 }, () =>
          expect.objectContaining({
            ok: false,
            status: 520,
            cf_ray: "failed-ray-DFW",
            duration_ms: expect.any(Number),
          }),
        ),
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("rejects a public edge response without browser CORS headers", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(healthResponse())
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
        expected_host_id: HOST_ID,
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
        expected_host_id: HOST_ID,
        fetchImpl,
      }),
    ).rejects.toThrow("health check returned HTTP 502");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a project-host that returns HTTP 200 before it is ready", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      response(
        200,
        { "content-type": "application/json" },
        JSON.stringify({
          ok: true,
          ready: false,
        }),
      ),
    );

    let caught: unknown;
    try {
      await probeProjectHostPublicRoute({
        public_url: PUBLIC_URL,
        origin: ORIGIN,
        expected_host_id: HOST_ID,
        fetchImpl,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("reported ready=false");
    expect(projectHostPublicRouteProbeDiagnostic(caught)).toMatchObject({
      stage: "health",
      expected_host_id: HOST_ID,
      health_status: 200,
      health_ok: true,
      health_ready: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("requires the exact unauthenticated session response", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(healthResponse())
      .mockResolvedValueOnce(response(204, corsHeaders()))
      .mockResolvedValueOnce(response(403, corsHeaders()));

    await expect(
      probeProjectHostPublicRoute({
        public_url: PUBLIC_URL,
        origin: ORIGIN,
        expected_host_id: HOST_ID,
        fetchImpl,
      }),
    ).rejects.toThrow("returned HTTP 403; expected 401");
  });

  it("rejects credentials embedded in the public URL", async () => {
    await expect(
      probeProjectHostPublicRoute({
        public_url: "https://user:secret@host.example.test",
        origin: ORIGIN,
        expected_host_id: HOST_ID,
        fetchImpl: jest.fn(),
      }),
    ).rejects.toThrow("must not contain credentials");
  });

  it("rejects a health response without a project-host identity", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      healthResponse({
        body: { host_id: undefined },
      }),
    );

    await expect(
      probeProjectHostPublicRoute({
        public_url: PUBLIC_URL,
        origin: ORIGIN,
        expected_host_id: HOST_ID,
        fetchImpl,
      }),
    ).rejects.toThrow("did not report host_id");
  });

  it("rejects a healthy response from the wrong project host", async () => {
    const wrongHostId = "777d774e-3f9c-43a0-9944-c2c25324741f";
    const fetchImpl = jest.fn().mockResolvedValue(
      healthResponse({
        body: { host_id: wrongHostId },
      }),
    );

    let caught: unknown;
    try {
      await probeProjectHostPublicRoute({
        public_url: PUBLIC_URL,
        origin: ORIGIN,
        expected_host_id: HOST_ID,
        fetchImpl,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as Error).message).toContain(
      `reached host "${wrongHostId}"; expected "${HOST_ID}"`,
    );
    expect(projectHostPublicRouteProbeDiagnostic(caught)).toMatchObject({
      stage: "health",
      expected_host_id: HOST_ID,
      health_host_id: wrongHostId,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
