/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

jest.mock("@cocalc/backend/data", () => ({
  conatPassword: "exam-test-secret",
}));

import { __test__ } from "./exam";

describe("project-host exam configuration", () => {
  it("derives the exam hostname from the stable project-host hostname", () => {
    expect(
      __test__.examHostnameForHost({
        id: "00000000-1000-4000-8000-000000000001",
        public_url:
          "https://host-00000000-1000-4000-8000-000000000001-staging.cocalc.ai",
      }),
    ).toBe("exam-00000000-1000-4000-8000-000000000001-staging.cocalc.ai");
  });

  it("requires an on-demand host", () => {
    expect(
      __test__.isHostOnDemand({
        id: "00000000-1000-4000-8000-000000000001",
        metadata: { effective_pricing_model: "spot" },
      }),
    ).toBe(false);
    expect(
      __test__.isHostOnDemand({
        id: "00000000-1000-4000-8000-000000000001",
        metadata: { effective_pricing_model: "on_demand" },
      }),
    ).toBe(true);
  });

  it("requires a reconciled public IPv4 address for exam DNS", () => {
    expect(
      __test__.publicIp({
        id: "00000000-1000-4000-8000-000000000001",
        public_ip: "34.0.129.201",
      }),
    ).toBe("34.0.129.201");
    expect(
      __test__.publicIp({
        id: "00000000-1000-4000-8000-000000000001",
        metadata: { runtime: { public_ip: "34.0.129.202" } },
      }),
    ).toBe("34.0.129.202");
    expect(() =>
      __test__.publicIp({
        id: "00000000-1000-4000-8000-000000000001",
        public_ip: null,
      }),
    ).toThrow("reconciled public IPv4");
  });

  it("follows the host's active public route transport", () => {
    expect(
      __test__.examDnsRoute({
        id: "00000000-1000-4000-8000-000000000001",
        metadata: {
          public_route: { active_mode: "cloudflare-proxy" },
          runtime: { public_ip: "34.0.129.201" },
        },
      }),
    ).toEqual({ type: "A", target: "34.0.129.201" });
    expect(
      __test__.examDnsRoute({
        id: "00000000-1000-4000-8000-000000000001",
        metadata: {
          cloudflare_tunnel: {
            id: "00000000-2000-4000-8000-000000000002",
          },
        },
      }),
    ).toEqual({
      type: "CNAME",
      target: "00000000-2000-4000-8000-000000000002.cfargotunnel.com",
    });
    expect(() =>
      __test__.examDnsRoute({
        id: "00000000-1000-4000-8000-000000000001",
      }),
    ).toThrow("active direct route or Cloudflare tunnel");
  });

  it("keeps terminal access disabled unless explicitly enabled", () => {
    const base = {
      enabled: true,
      max_projects: 100,
      project_cpu: 1,
      project_memory_mb: 2_000,
      project_disk_mb: 5_000,
      project_ttl_minutes: 360,
      cleanup_grace_minutes: 10,
      network_mode: "disabled" as const,
    };
    expect(__test__.normalizeConfig(base).terminal_enabled).toBe(false);
    expect(
      __test__.normalizeConfig({ ...base, terminal_enabled: true })
        .terminal_enabled,
    ).toBe(true);
  });

  it("rejects unsupported exam network modes", () => {
    expect(() =>
      __test__.normalizeConfig({
        ...__test__.DEFAULT_EXAM_CONFIG,
        enabled: true,
        network_mode: "enabled" as any,
      }),
    ).toThrow("supports only disabled");
  });

  it("stores a memory-hard token hash rather than the plaintext token", () => {
    const encoded = __test__.hashToken("do-not-store-this-token");
    expect(encoded).toMatch(/^scrypt-v1\$[^$]+\$[^$]+$/);
    expect(encoded).not.toContain("do-not-store-this-token");
  });
});
