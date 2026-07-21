/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const queryMock = jest.fn();
const getServerSettingsMock = jest.fn();
const siteUrlMock = jest.fn();
const ensureTunnelMock = jest.fn();
const ensureHostDnsMock = jest.fn();
const ensureAddressDnsMock = jest.fn();
const deleteHostDnsMock = jest.fn();
const getCloudflareIpv4CidrsMock = jest.fn();
const ensurePublicIngressMock = jest.fn();
const reconcileBootstrapMock = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query: queryMock }),
}));

jest.mock("@cocalc/database/settings/server-settings", () => ({
  getServerSettings: (...args: any[]) => getServerSettingsMock(...args),
}));

jest.mock("@cocalc/database/settings/site-url", () => ({
  __esModule: true,
  default: (...args: any[]) => siteUrlMock(...args),
}));

jest.mock("./cloudflare-tunnel", () => ({
  ensureCloudflareTunnelForHost: (...args: any[]) => ensureTunnelMock(...args),
}));

jest.mock("./dns", () => ({
  deleteHostDns: (...args: any[]) => deleteHostDnsMock(...args),
  ensureHostDns: (...args: any[]) => ensureHostDnsMock(...args),
  ensureProxiedAddressDns: (...args: any[]) => ensureAddressDnsMock(...args),
  getCloudflareIpv4Cidrs: (...args: any[]) =>
    getCloudflareIpv4CidrsMock(...args),
}));

jest.mock("./provider-context", () => ({
  getProviderContext: async () => ({
    entry: {
      provider: { ensurePublicIngress: ensurePublicIngressMock },
    },
    creds: { project_id: "staging-project" },
  }),
}));

jest.mock("@cocalc/server/conat/api/hosts-bootstrap-reconcile", () => ({
  reconcileCloudHostBootstrapOverSsh: (...args: any[]) =>
    reconcileBootstrapMock(...args),
}));

describe("project-host public route migration", () => {
  let row: any;

  beforeEach(() => {
    jest.clearAllMocks();
    row = {
      id: "37782b66-190d-41c3-a7e5-f5662e34cd4a",
      name: "host2",
      region: "us-central1",
      status: "running",
      metadata: {
        machine: { cloud: "gcp" },
        runtime: {
          provider: "gcp",
          instance_id: "staging-host2",
          zone: "us-central1-a",
          public_ip: "203.0.113.20",
        },
        cloudflare_tunnel: {
          id: "tunnel-id",
          hostname:
            "host-37782b66-190d-41c3-a7e5-f5662e34cd4a-staging.example.com",
          record_id: "stable-record",
        },
      },
    };
    queryMock.mockImplementation(async (sql: string, params: any[]) => {
      if (/SELECT id, name, region/.test(sql)) {
        return { rows: [structuredClone(row)] };
      }
      if (/UPDATE project_hosts/.test(sql)) {
        row.metadata ??= {};
        row.metadata[params[1]] = JSON.parse(params[2]);
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    getServerSettingsMock.mockResolvedValue({
      dns: "https://staging.example.com",
      project_hosts_cloudflare_tunnel_host_suffix: "-staging",
    });
    siteUrlMock.mockResolvedValue("https://staging.example.com/");
    getCloudflareIpv4CidrsMock.mockResolvedValue(["173.245.48.0/20"]);
    ensureAddressDnsMock.mockResolvedValue({
      name: "direct-check.example.com",
      record_id: "probe-record",
    });
    ensureHostDnsMock.mockResolvedValue({
      name: "host-37782b66-190d-41c3-a7e5-f5662e34cd4a-staging.example.com",
      record_id: "stable-record",
    });
    deleteHostDnsMock.mockResolvedValue(undefined);
    ensureTunnelMock.mockResolvedValue(row.metadata.cloudflare_tunnel);
    ensurePublicIngressMock.mockResolvedValue(undefined);
    reconcileBootstrapMock.mockResolvedValue(undefined);
    global.fetch = jest.fn(async (_url, opts: RequestInit) => ({
      status: 204,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "access-control-allow-origin"
            ? (opts.headers as Record<string, string>).Origin
            : null,
      },
    })) as any;
  });

  it("prepares, probes, and activates a proxied public-IP route", async () => {
    const { migrateHostPublicRouteInternal } = await import("./public-route");

    await expect(
      migrateHostPublicRouteInternal({
        id: row.id,
        mode: "cloudflare-proxy",
      }),
    ).resolves.toMatchObject({
      host_id: row.id,
      mode: "cloudflare-proxy",
    });

    expect(ensurePublicIngressMock).toHaveBeenCalledWith(
      row.metadata.runtime,
      { ports: [443], source_ranges: ["173.245.48.0/20"] },
      { project_id: "staging-project" },
    );
    expect(reconcileBootstrapMock).toHaveBeenCalledWith(
      expect.objectContaining({ host_id: row.id, scope: "full" }),
    );
    expect(ensureAddressDnsMock).toHaveBeenCalledWith(
      expect.objectContaining({ ipAddress: "203.0.113.20" }),
    );
    expect(deleteHostDnsMock).toHaveBeenCalledWith(
      expect.objectContaining({ record_id: "probe-record" }),
    );
    expect(ensureHostDnsMock).toHaveBeenCalledWith({
      host_id: row.id,
      ipAddress: "203.0.113.20",
      record_id: "stable-record",
    });
    expect(row.metadata.public_route).toMatchObject({
      desired_mode: "cloudflare-proxy",
      active_mode: "cloudflare-proxy",
      status: "active",
      error: null,
    });
  });

  it("restores the tunnel route when direct-route preparation fails", async () => {
    ensurePublicIngressMock.mockRejectedValueOnce(
      new Error("firewall reconciliation failed"),
    );
    const { migrateHostPublicRouteInternal } = await import("./public-route");

    await expect(
      migrateHostPublicRouteInternal({
        id: row.id,
        mode: "cloudflare-proxy",
      }),
    ).rejects.toThrow("firewall reconciliation failed");

    expect(ensureTunnelMock).toHaveBeenCalledWith({
      host_id: row.id,
      existing: row.metadata.cloudflare_tunnel,
    });
    expect(row.metadata.public_route).toMatchObject({
      desired_mode: "cloudflare-proxy",
      active_mode: "cloudflare-tunnel",
      status: "failed",
    });
  });
});
