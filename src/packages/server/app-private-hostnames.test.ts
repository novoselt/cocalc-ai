/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const hasDns = jest.fn(async () => true);
const ensureAppSubdomainDns = jest.fn(async ({ record_id }) => ({
  record_id: record_id ?? "dns-record-1",
}));
const deleteAppSubdomainDns = jest.fn(async () => undefined);
const getCnameTargetForHostname = jest.fn(async () => undefined);
const getServerSettings = jest.fn(async () => ({
  project_hosts_app_private_hostnames_enabled: true,
}));
const siteUrl = jest.fn(async () => "https://cocalc.ai");

type Row = {
  project_id: string;
  app_id: string;
  label: string;
  hostname: string;
  base_path: string;
  dns_record_id?: string | null;
  dns_target?: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  last_dns_error?: string | null;
};

const rows = new Map<string, Row>();
let failDnsRecordUpdate = false;

function key(project_id: string, app_id: string): string {
  return `${project_id}:${app_id}`;
}

const query = jest.fn(async (sqlRaw: string, params: any[] = []) => {
  const sql = sqlRaw.replace(/\s+/g, " ").trim();
  if (sql.startsWith("CREATE TABLE")) {
    return { rows: [], rowCount: 0 };
  }
  if (sql.includes("FROM projects") && sql.includes("project_hosts")) {
    return {
      rows: [
        {
          public_url: "https://host-abc.cocalc.ai",
          internal_url: "http://10.0.0.2:5000",
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.startsWith("INSERT INTO project_app_private_hostnames")) {
    const [project_id, app_id, label, hostname, base_path, created_by] = params;
    let row = rows.get(key(project_id, app_id));
    if (!row) {
      row = {
        project_id,
        app_id,
        label,
        hostname,
        base_path,
        created_by,
        created_at: new Date("2026-07-26T00:00:00Z"),
        updated_at: new Date("2026-07-26T00:00:00Z"),
      };
      rows.set(key(project_id, app_id), row);
    } else {
      row.base_path = base_path;
      row.updated_at = new Date();
    }
    return { rows: [{ ...row }], rowCount: 1 };
  }
  if (
    sql.startsWith("UPDATE project_app_private_hostnames") &&
    sql.includes("dns_record_id=$3")
  ) {
    if (failDnsRecordUpdate) {
      failDnsRecordUpdate = false;
      throw new Error("postgres unavailable");
    }
    const [project_id, app_id, dns_record_id, dns_target] = params;
    const row = rows.get(key(project_id, app_id))!;
    row.dns_record_id = dns_record_id;
    row.dns_target = dns_target;
    row.last_dns_error = null;
    row.updated_at = new Date();
    return { rows: [{ ...row }], rowCount: 1 };
  }
  if (
    sql.startsWith("UPDATE project_app_private_hostnames") &&
    sql.includes("last_dns_error=$3")
  ) {
    const [project_id, app_id, error, dns_record_id] = params;
    const row = rows.get(key(project_id, app_id))!;
    row.last_dns_error = error;
    if (dns_record_id) {
      row.dns_record_id = dns_record_id;
    }
    row.updated_at = new Date();
    return { rows: [], rowCount: 1 };
  }
  if (
    sql.startsWith("SELECT * FROM project_app_private_hostnames") &&
    sql.includes("app_id=$2")
  ) {
    const row = rows.get(key(params[0], params[1]));
    return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
  }
  if (
    sql.startsWith("SELECT * FROM project_app_private_hostnames") &&
    !sql.includes("app_id=$2")
  ) {
    const selected = [...rows.values()].filter(
      (row) => row.project_id === params[0],
    );
    return {
      rows: selected.map((row) => ({ ...row })),
      rowCount: selected.length,
    };
  }
  if (
    sql.startsWith("SELECT COUNT(*)::int AS count") &&
    sql.includes("FROM project_app_private_hostnames")
  ) {
    return {
      rows: [
        {
          count: [...rows.values()].filter(
            (row) => row.project_id === params[0],
          ).length,
        },
      ],
      rowCount: 1,
    };
  }
  if (
    sql.startsWith(
      "SELECT project_id, app_id, base_path FROM project_app_private_hostnames",
    )
  ) {
    const hostname = `${params[0]}`.toLowerCase();
    const row = [...rows.values()].find(
      (value) => value.hostname.toLowerCase() === hostname,
    );
    return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
  }
  if (sql.startsWith("DELETE FROM project_app_private_hostnames")) {
    const deleted = rows.delete(key(params[0], params[1]));
    return { rows: [], rowCount: deleted ? 1 : 0 };
  }
  throw new Error(`unhandled SQL in test: ${sql}`);
});

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query }),
}));

jest.mock("@cocalc/database/settings/server-settings", () => ({
  getServerSettings: (...args: any[]) => getServerSettings(...args),
}));

jest.mock("@cocalc/database/settings/site-url", () => ({
  __esModule: true,
  default: (...args: any[]) => siteUrl(...args),
}));

jest.mock("@cocalc/server/cloud/dns", () => ({
  hasDns: (...args: any[]) => hasDns(...args),
  ensureAppSubdomainDns: (...args: any[]) => ensureAppSubdomainDns(...args),
  deleteAppSubdomainDns: (...args: any[]) => deleteAppSubdomainDns(...args),
  getCnameTargetForHostname: (...args: any[]) =>
    getCnameTargetForHostname(...args),
}));

import {
  clearPrivateAppHostnameCache,
  getPrivateAppRouteByHostname,
  getProjectAppPrivateHostnamePolicy,
  inspectProjectAppPrivateHostname,
  releaseProjectAppPrivateHostname,
  reserveProjectAppPrivateHostname,
} from "./app-private-hostnames";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

describe("private app hostnames", () => {
  beforeEach(() => {
    rows.clear();
    failDnsRecordUpdate = false;
    clearPrivateAppHostnameCache();
    jest.clearAllMocks();
    hasDns.mockResolvedValue(true);
    getServerSettings.mockResolvedValue({
      project_hosts_app_private_hostnames_enabled: true,
    });
    siteUrl.mockResolvedValue("https://cocalc.ai");
    getCnameTargetForHostname.mockResolvedValue(undefined);
    ensureAppSubdomainDns.mockImplementation(async ({ record_id }) => ({
      record_id: record_id ?? "dns-record-1",
    }));
    deleteAppSubdomainDns.mockResolvedValue(undefined);
  });

  it("idempotently reserves a server-generated private hostname", async () => {
    const first = await reserveProjectAppPrivateHostname({
      project_id: PROJECT_ID,
      app_id: "workspace-dev",
      created_by: ACCOUNT_ID,
    });
    const second = await reserveProjectAppPrivateHostname({
      project_id: PROJECT_ID,
      app_id: "workspace-dev",
      created_by: ACCOUNT_ID,
    });

    expect(first.hostname).toMatch(/^dev-[0-9a-f]{16}\.cocalc\.ai$/);
    expect(second.hostname).toBe(first.hostname);
    expect(first.base_path).toBe("/apps/workspace-dev");
    expect(first.url).toBe(`https://${first.hostname}`);
    expect(ensureAppSubdomainDns).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        hostname: first.hostname,
        target_hostname: "host-abc.cocalc.ai",
        adopt_existing: false,
      }),
    );
    expect(ensureAppSubdomainDns).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        hostname: first.hostname,
        record_id: "dns-record-1",
        adopt_existing: true,
      }),
    );
    await expect(getPrivateAppRouteByHostname(first.hostname)).resolves.toEqual(
      {
        project_id: PROJECT_ID,
        app_id: "workspace-dev",
        base_path: "/apps/workspace-dev",
      },
    );
  });

  it("fails closed when private hostname routing is disabled", async () => {
    const reserved = await reserveProjectAppPrivateHostname({
      project_id: PROJECT_ID,
      app_id: "workspace-dev",
      created_by: ACCOUNT_ID,
    });
    clearPrivateAppHostnameCache();
    getServerSettings.mockResolvedValue({
      project_hosts_app_private_hostnames_enabled: false,
    });

    await expect(
      getPrivateAppRouteByHostname(reserved.hostname),
    ).resolves.toBeUndefined();
  });

  it("rejects project hosts that still depend on a Cloudflare tunnel", async () => {
    getCnameTargetForHostname.mockResolvedValue(
      "11111111-1111-4111-8111-111111111111.cfargotunnel.com",
    );

    await expect(
      getProjectAppPrivateHostnamePolicy(PROJECT_ID),
    ).resolves.toMatchObject({
      enabled: false,
      warnings: [
        expect.stringContaining(
          "private app hostnames require a direct project-host route",
        ),
      ],
    });
  });

  it("uses an explicit one-level hostname domain instead of nesting under the site", async () => {
    getServerSettings.mockResolvedValue({
      project_hosts_app_private_hostnames_enabled: true,
      project_hosts_app_private_hostname_domain: "cocalc.dev",
    });
    siteUrl.mockResolvedValue("https://staging.cocalc.ai");

    const reserved = await reserveProjectAppPrivateHostname({
      project_id: PROJECT_ID,
      app_id: "workspace-dev",
      created_by: ACCOUNT_ID,
    });

    expect(reserved.hostname).toMatch(/^dev-[0-9a-f]{16}\.cocalc\.dev$/);
  });

  it("bounds DNS allocations per project", async () => {
    for (let i = 0; i < 32; i += 1) {
      const app_id = `app-${i}`;
      rows.set(key(PROJECT_ID, app_id), {
        project_id: PROJECT_ID,
        app_id,
        label: `dev-${i}`,
        hostname: `dev-${i}.cocalc.ai`,
        base_path: `/apps/${app_id}`,
        created_by: ACCOUNT_ID,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    await expect(
      reserveProjectAppPrivateHostname({
        project_id: PROJECT_ID,
        app_id: "one-too-many",
        created_by: ACCOUNT_ID,
      }),
    ).rejects.toThrow("at most 32 private app hostnames");
    expect(ensureAppSubdomainDns).not.toHaveBeenCalled();
  });

  it("keeps the route row when DNS deletion fails", async () => {
    const reserved = await reserveProjectAppPrivateHostname({
      project_id: PROJECT_ID,
      app_id: "workspace-dev",
      created_by: ACCOUNT_ID,
    });
    deleteAppSubdomainDns.mockRejectedValueOnce(new Error("cloudflare down"));

    await expect(
      releaseProjectAppPrivateHostname({
        project_id: PROJECT_ID,
        app_id: "workspace-dev",
      }),
    ).rejects.toThrow("cloudflare down");
    await expect(
      inspectProjectAppPrivateHostname({
        project_id: PROJECT_ID,
        app_id: "workspace-dev",
      }),
    ).resolves.toMatchObject({
      hostname: reserved.hostname,
      last_dns_error: expect.stringContaining("cloudflare down"),
    });
  });

  it("removes newly created DNS when persisting its record id fails", async () => {
    failDnsRecordUpdate = true;

    await expect(
      reserveProjectAppPrivateHostname({
        project_id: PROJECT_ID,
        app_id: "workspace-dev",
        created_by: ACCOUNT_ID,
      }),
    ).rejects.toThrow("postgres unavailable");

    const [created] = [...rows.values()];
    expect(deleteAppSubdomainDns).toHaveBeenCalledWith({
      record_id: "dns-record-1",
      hostname: created.hostname,
    });
    expect(created.dns_record_id).toBeUndefined();
    expect(created.last_dns_error).toContain("postgres unavailable");
  });

  it("retains an orphaned DNS record id when compensating deletion fails", async () => {
    failDnsRecordUpdate = true;
    deleteAppSubdomainDns.mockRejectedValueOnce(
      new Error("cloudflare delete unavailable"),
    );

    await expect(
      reserveProjectAppPrivateHostname({
        project_id: PROJECT_ID,
        app_id: "workspace-dev",
        created_by: ACCOUNT_ID,
      }),
    ).rejects.toThrow("postgres unavailable");

    const [created] = [...rows.values()];
    expect(created.dns_record_id).toBe("dns-record-1");
    expect(created.last_dns_error).toContain(
      "compensating DNS deletion failed for record dns-record-1",
    );
  });

  it("deletes DNS before removing the route row", async () => {
    const reserved = await reserveProjectAppPrivateHostname({
      project_id: PROJECT_ID,
      app_id: "workspace-dev",
      created_by: ACCOUNT_ID,
    });

    await expect(
      releaseProjectAppPrivateHostname({
        project_id: PROJECT_ID,
        app_id: "workspace-dev",
      }),
    ).resolves.toEqual({ released: true });
    expect(deleteAppSubdomainDns).toHaveBeenCalledWith({
      record_id: "dns-record-1",
      hostname: reserved.hostname,
    });
    await expect(
      inspectProjectAppPrivateHostname({
        project_id: PROJECT_ID,
        app_id: "workspace-dev",
      }),
    ).resolves.toBeUndefined();
  });
});
