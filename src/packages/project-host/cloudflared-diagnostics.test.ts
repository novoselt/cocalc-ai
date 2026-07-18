/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  cloudflaredHeartbeatSummary,
  collectCloudflaredDiagnosticSnapshot,
  normalizeCloudflaredProtocol,
  parseCloudflaredProcess,
  parseCloudflaredTunnel,
  parseCloudflaredVersion,
  selectCloudflaredMetrics,
} from "./cloudflared-diagnostics";

describe("cloudflared diagnostics", () => {
  it("parses bounded process, tunnel, and metric state", () => {
    expect(
      parseCloudflaredVersion("cloudflared version 2026.7.2 (built x)"),
    ).toBe("2026.7.2");
    expect(parseCloudflaredProcess("123 Ssl 3600 2048 18\n")).toEqual({
      pid: 123,
      state: "Ssl",
      elapsed: "3600",
      rss_kb: 2048,
      threads: 18,
    });
    expect(
      parseCloudflaredTunnel({
        tunnelID: "tunnel-1",
        connectorID: "connector-1",
        connections: [
          {
            index: 0,
            isConnected: true,
            protocol: 1,
            edgeAddress: "198.51.100.2",
          },
        ],
      }),
    ).toEqual({
      tunnel_id: "tunnel-1",
      connector_id: "connector-1",
      connections: [
        {
          index: 0,
          connected: true,
          protocol: "quic",
          edge_address: "198.51.100.2",
        },
      ],
    });
    expect(
      selectCloudflaredMetrics(
        [
          "# HELP ignored ignored",
          'cloudflared_tunnel_server_locations{edge_location="dfw01"} 1',
          "process_cpu_seconds_total 1",
          'quic_client_lost_packets{conn_index="0",reason="timeout"} 2',
        ].join("\n"),
      ),
    ).toEqual([
      'cloudflared_tunnel_server_locations{edge_location="dfw01"} 1',
      'quic_client_lost_packets{conn_index="0",reason="timeout"} 2',
    ]);
  });

  it("normalizes cloudflared's numeric connection protocol enum", () => {
    expect(normalizeCloudflaredProtocol(0)).toBe("http2");
    expect(normalizeCloudflaredProtocol("1")).toBe("quic");
    expect(normalizeCloudflaredProtocol("future")).toBe("future");
    expect(normalizeCloudflaredProtocol(undefined)).toBeUndefined();
  });

  it("collects only the allowlisted local diagnostics", async () => {
    const fetchImpl = jest.fn(async (value: string | URL | Request) => {
      const url = `${value}`;
      if (url.endsWith(":20241/ready")) {
        return new Response(
          JSON.stringify({
            status: 200,
            readyConnections: 4,
            connectorId: "connector-1",
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/diag/tunnel")) {
        return new Response(
          JSON.stringify({
            tunnelID: "tunnel-1",
            connectorID: "connector-1",
            connections: [{ index: 0, protocol: "quic" }],
          }),
        );
      }
      if (url.endsWith("/metrics")) {
        return new Response(
          "quic_client_total_connections 4\nsecret_metric 1\n",
        );
      }
      throw new Error("connection refused");
    }) as typeof fetch;
    const snapshot = await collectCloudflaredDiagnosticSnapshot({
      fetchImpl,
      execute: async (command) =>
        command.includes("cloudflared")
          ? { stdout: "cloudflared version 2026.7.2", exit_code: 0 }
          : { stdout: "123 Ssl 60 2048 18", exit_code: 0 },
      readJournal: async () => "recent tunnel line",
    });
    expect(snapshot).toMatchObject({
      version: "2026.7.2",
      version_drift: false,
      process: { pid: 123 },
      ready: { status: 200, ready_connections: 4 },
      tunnel: { connector_id: "connector-1" },
      metrics: ["quic_client_total_connections 4"],
      journal: "recent tunnel line",
    });
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining("/diag/configuration"),
      expect.anything(),
    );
    expect(cloudflaredHeartbeatSummary(snapshot)).toMatchObject({
      ready_connections: 4,
      connector_id: "connector-1",
      process_elapsed_s: 60,
    });
  });
});
