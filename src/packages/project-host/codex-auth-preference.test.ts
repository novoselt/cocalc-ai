import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const mockGetSiteOpenAiApiKeyFromHub = jest.fn(async () => "site-key");
const mockHasSubscriptionAuthInRegistry = jest.fn(async () => true);

jest.mock("@cocalc/backend/logger", () => ({
  __esModule: true,
  default: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock("./codex/codex-auth-registry", () => ({
  getAccountOpenAiApiKeyFromRegistry: jest.fn(async () => "account-key"),
  getProjectOpenAiApiKeyFromRegistry: jest.fn(async () => "project-key"),
  getSiteOpenAiApiKeyFromHub: (...args: unknown[]) =>
    mockGetSiteOpenAiApiKeyFromHub(...args),
  hasSubscriptionAuthInRegistry: (...args: unknown[]) =>
    mockHasSubscriptionAuthInRegistry(...args),
  pullSubscriptionAuthFromRegistry: jest.fn(async () => ({ pulled: false })),
  syncSubscriptionAuthToRegistryIfChanged: jest.fn(async () => undefined),
  touchSubscriptionAuthInRegistry: jest.fn(async () => undefined),
}));

jest.mock("./codex/codex-subscription-cache-gc", () => ({
  touchSubscriptionCacheUsage: jest.fn(async () => undefined),
}));

describe("Codex auth source preference", () => {
  let root: string;
  const accountId = "00000000-0000-4000-8000-000000000001";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-auth-pref-"));
    process.env.COCALC_CODEX_AUTH_SUBSCRIPTION_HOME_ROOT = root;
    process.env.COCALC_CODEX_AUTH_SHARED_HOME_MODE = "disabled";
    await fs.mkdir(path.join(root, accountId), { recursive: true });
    await fs.writeFile(path.join(root, accountId, "auth.json"), "{}\n");
    mockGetSiteOpenAiApiKeyFromHub.mockClear();
    mockHasSubscriptionAuthInRegistry.mockClear();
  });

  afterEach(async () => {
    delete process.env.COCALC_CODEX_AUTH_SUBSCRIPTION_HOME_ROOT;
    delete process.env.COCALC_CODEX_AUTH_SHARED_HOME_MODE;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps subscription-first behavior in automatic mode", async () => {
    const { resolveCodexAuthRuntime } = await import("./codex/codex-auth");
    const runtime = await resolveCodexAuthRuntime({
      projectId: "project-1",
      accountId,
      preference: "auto",
    });
    expect(runtime.source).toBe("subscription");
    expect(mockGetSiteOpenAiApiKeyFromHub).not.toHaveBeenCalled();
  });

  it("uses included site funding when explicitly selected", async () => {
    const { resolveCodexAuthRuntime } = await import("./codex/codex-auth");
    const runtime = await resolveCodexAuthRuntime({
      projectId: "project-1",
      accountId,
      preference: "site-api-key",
    });
    expect(runtime).toMatchObject({
      source: "site-api-key",
      env: { OPENAI_API_KEY: "site-key" },
    });
    expect(mockGetSiteOpenAiApiKeyFromHub).toHaveBeenCalledWith({
      forceRefresh: true,
    });
    expect(mockHasSubscriptionAuthInRegistry).not.toHaveBeenCalled();
  });
});
