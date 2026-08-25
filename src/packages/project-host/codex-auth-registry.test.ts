import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const callHubMock = jest.fn();
const getMasterConatClientMock = jest.fn(() => ({ request: jest.fn() }));
const getLocalHostIdMock = jest.fn(() => "host-1");

jest.mock("@cocalc/backend/logger", () => ({
  __esModule: true,
  default: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock("@cocalc/conat/hub/call-hub", () => ({
  __esModule: true,
  default: (...args) => callHubMock(...args),
}));

jest.mock("./master-conat-client", () => ({
  getMasterConatClient: () => getMasterConatClientMock(),
}));

jest.mock("./sqlite/hosts", () => ({
  getLocalHostId: () => getLocalHostIdMock(),
}));

describe("syncSubscriptionAuthToRegistryIfChanged", () => {
  let tempDirs: string[] = [];

  function mkTempDir(prefix: string) {
    const dir = mkdtempSync(path.join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function authPayload(accessToken: string, lastRefresh?: string): string {
    return JSON.stringify({
      tokens: {
        access_token: accessToken,
        account_id: "chatgpt-account",
      },
      ...(lastRefresh ? { last_refresh: lastRefresh } : {}),
    });
  }

  beforeEach(() => {
    tempDirs = [];
    callHubMock.mockReset();
    getMasterConatClientMock.mockClear();
    getLocalHostIdMock.mockClear();
    jest.resetModules();
  });

  afterEach(() => {
    for (const dir of tempDirs.reverse()) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to upload an auth placeholder as a credential", async () => {
    const root = mkTempDir("cocalc-auth-placeholder-");
    writeFileSync(path.join(root, "auth.json"), "{}\n");
    const { pushSubscriptionAuthToRegistry } =
      await import("./codex/codex-auth-registry");

    await expect(
      pushSubscriptionAuthToRegistry({
        projectId: "project-placeholder",
        accountId: "account-placeholder",
        codexHome: root,
      }),
    ).resolves.toEqual({ ok: false });
    expect(callHubMock).not.toHaveBeenCalled();
  });

  it("pushes local auth once and skips unchanged content", async () => {
    const root = mkTempDir("cocalc-auth-sync-");
    writeFileSync(path.join(root, "auth.json"), authPayload("one"));

    callHubMock.mockImplementation(async ({ name }) =>
      name === "hosts.upsertExternalCredential" ? { id: "cred-1" } : undefined,
    );
    const { syncSubscriptionAuthToRegistryIfChanged } =
      await import("./codex/codex-auth-registry");

    await expect(
      syncSubscriptionAuthToRegistryIfChanged({
        projectId: "project-1",
        accountId: "account-1",
        codexHome: root,
      }),
    ).resolves.toEqual({
      ok: true,
      id: "cred-1",
      skipped: false,
    });
    await expect(
      syncSubscriptionAuthToRegistryIfChanged({
        projectId: "project-1",
        accountId: "account-1",
        codexHome: root,
      }),
    ).resolves.toEqual({
      ok: true,
      skipped: true,
    });
    expect(callHubMock).toHaveBeenCalledTimes(2);
  });

  it("pushes again after auth.json changes", async () => {
    const root = mkTempDir("cocalc-auth-sync-");
    const authPath = path.join(root, "auth.json");
    writeFileSync(authPath, authPayload("one"));

    callHubMock.mockImplementation(async ({ name }) =>
      name === "hosts.upsertExternalCredential" ? { id: "cred-1" } : undefined,
    );
    const { syncSubscriptionAuthToRegistryIfChanged } =
      await import("./codex/codex-auth-registry");

    await syncSubscriptionAuthToRegistryIfChanged({
      projectId: "project-2",
      accountId: "account-2",
      codexHome: root,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    writeFileSync(authPath, authPayload("two"));
    await expect(
      syncSubscriptionAuthToRegistryIfChanged({
        projectId: "project-2",
        accountId: "account-2",
        codexHome: root,
      }),
    ).resolves.toEqual({
      ok: true,
      id: "cred-1",
      skipped: false,
    });
    expect(callHubMock).toHaveBeenCalledTimes(4);
  });

  it("does not rewrite identical registry auth", async () => {
    const root = mkTempDir("cocalc-auth-sync-");
    const payload = authPayload("same", "2026-08-22T00:00:00.000Z");
    writeFileSync(path.join(root, "auth.json"), payload);
    callHubMock.mockResolvedValue({ id: "cred-1", payload });
    const { syncSubscriptionAuthToRegistryIfChanged } =
      await import("./codex/codex-auth-registry");

    await expect(
      syncSubscriptionAuthToRegistryIfChanged({
        projectId: "project-same",
        accountId: "account-same",
        codexHome: root,
      }),
    ).resolves.toEqual({
      ok: true,
      id: "cred-1",
      skipped: true,
    });
    expect(callHubMock).toHaveBeenCalledTimes(1);
    expect(callHubMock.mock.calls[0][0].name).toBe(
      "hosts.getExternalCredential",
    );
  });

  it("keeps newer registry auth instead of overwriting it", async () => {
    const root = mkTempDir("cocalc-auth-sync-");
    const authPath = path.join(root, "auth.json");
    const localPayload = authPayload("local-old", "2026-08-21T00:00:00.000Z");
    const registryPayload = authPayload(
      "registry-new",
      "2026-08-22T00:00:00.000Z",
    );
    writeFileSync(authPath, localPayload);
    callHubMock.mockResolvedValue({ id: "cred-1", payload: registryPayload });
    const { syncSubscriptionAuthToRegistryIfChanged } =
      await import("./codex/codex-auth-registry");

    await expect(
      syncSubscriptionAuthToRegistryIfChanged({
        projectId: "project-stale",
        accountId: "account-stale",
        codexHome: root,
      }),
    ).resolves.toEqual({
      ok: true,
      id: "cred-1",
      skipped: true,
    });
    expect(readFileSync(authPath, "utf8")).toBe(registryPayload);
    expect(callHubMock).toHaveBeenCalledTimes(1);
  });

  it("pulls registry auth when it is newer than local auth", async () => {
    const root = mkTempDir("cocalc-auth-pull-");
    const authPath = path.join(root, "auth.json");
    writeFileSync(authPath, '{"token":"old"}\n');
    const oldTime = new Date(Date.now() - 60_000);
    utimesSync(authPath, oldTime, oldTime);

    callHubMock.mockResolvedValue({
      payload: '{"token":"new"}\n',
      updated: new Date().toISOString(),
    });
    const { pullSubscriptionAuthFromRegistry } =
      await import("./codex/codex-auth-registry");

    await expect(
      pullSubscriptionAuthFromRegistry({
        projectId: "project-3",
        accountId: "account-3",
        codexHome: root,
        onlyIfNewer: true,
      }),
    ).resolves.toMatchObject({
      pulled: true,
      source: "registry",
    });
    expect(readFileSync(authPath, "utf8")).toBe('{"token":"new"}\n');
  });

  it("keeps local auth when it is newer than registry auth", async () => {
    const root = mkTempDir("cocalc-auth-pull-");
    const authPath = path.join(root, "auth.json");
    writeFileSync(authPath, '{"token":"local"}\n');
    const newTime = new Date(Date.now() + 60_000);
    utimesSync(authPath, newTime, newTime);

    callHubMock.mockResolvedValue({
      payload: '{"token":"registry"}\n',
      updated: new Date().toISOString(),
    });
    const { pullSubscriptionAuthFromRegistry } =
      await import("./codex/codex-auth-registry");

    await expect(
      pullSubscriptionAuthFromRegistry({
        projectId: "project-4",
        accountId: "account-4",
        codexHome: root,
        onlyIfNewer: true,
      }),
    ).resolves.toMatchObject({
      pulled: false,
      skipped: "local-newer",
    });
    expect(readFileSync(authPath, "utf8")).toBe('{"token":"local"}\n');
  });
});
