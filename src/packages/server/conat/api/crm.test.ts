/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

/** @jest-environment node */

const mockCentralLog = jest.fn();
const mockIsAdmin = jest.fn();
const mockGetConfiguredBayId = jest.fn();
const mockGetConfiguredClusterSeedBayId = jest.fn();
const mockDispatchCrmSeedRequest = jest.fn();
const mockAssertCrmCapability = jest.fn();
const mockCrmActionCapabilities = jest.fn();
const mockGetInterBayBridge = jest.fn();
const mockRequireDangerousSessionAuth = jest.fn();

jest.mock("@cocalc/database/postgres/central-log", () => ({
  __esModule: true,
  default: (...args: any[]) => mockCentralLog(...args),
}));
jest.mock("@cocalc/server/accounts/is-admin", () => ({
  __esModule: true,
  default: (...args: any[]) => mockIsAdmin(...args),
}));
jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: (...args: any[]) => mockGetConfiguredBayId(...args),
}));
jest.mock("@cocalc/server/cluster-config", () => ({
  getConfiguredClusterSeedBayId: (...args: any[]) =>
    mockGetConfiguredClusterSeedBayId(...args),
}));
jest.mock("@cocalc/server/crm/dispatch", () => ({
  dispatchCrmSeedRequest: (...args: any[]) =>
    mockDispatchCrmSeedRequest(...args),
}));
jest.mock("@cocalc/server/crm/feature-flags", () => ({
  assertCrmCapability: (...args: any[]) => mockAssertCrmCapability(...args),
  crmActionCapabilities: (...args: any[]) => mockCrmActionCapabilities(...args),
}));
jest.mock("@cocalc/server/inter-bay/bridge", () => ({
  getInterBayBridge: (...args: any[]) => mockGetInterBayBridge(...args),
}));
jest.mock("./dangerous-session-auth", () => ({
  requireDangerousSessionAuth: (...args: any[]) =>
    mockRequireDangerousSessionAuth(...args),
}));

import {
  createOpportunity,
  createOrganization,
  getCustomerMetrics,
  listOrganizations,
  mutateExternalReference,
  searchOrganizations,
} from "./crm";

const BASE = {
  account_id: "admin-1",
  browser_id: "browser-1",
  session_hash: "session-1",
  reason: "Review institutional customer",
};

describe("CRM public Conat API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockResolvedValue(true);
    mockGetConfiguredBayId.mockReturnValue("seed-bay");
    mockGetConfiguredClusterSeedBayId.mockReturnValue("seed-bay");
    mockDispatchCrmSeedRequest.mockResolvedValue({ organizations: [] });
    mockCrmActionCapabilities.mockReturnValue(["visible"]);
    mockAssertCrmCapability.mockResolvedValue(undefined);
    mockCentralLog.mockResolvedValue(undefined);
    mockRequireDangerousSessionAuth.mockResolvedValue(undefined);
  });

  it("rejects unauthenticated and non-admin customer reads", async () => {
    await expect(
      listOrganizations({ reason: BASE.reason } as any),
    ).rejects.toThrow("must be signed in");
    mockIsAdmin.mockResolvedValue(false);
    await expect(listOrganizations(BASE as any)).rejects.toMatchObject({
      code: 403,
    });
    expect(mockDispatchCrmSeedRequest).not.toHaveBeenCalled();
  });

  it("routes bounded reads locally without leaking session credentials", async () => {
    await listOrganizations({ ...BASE, limit: 25 });
    expect(mockRequireDangerousSessionAuth).not.toHaveBeenCalled();
    expect(mockCrmActionCapabilities).toHaveBeenCalledWith(
      "listOrganizations",
      expect.objectContaining({ limit: 25 }),
    );
    expect(mockDispatchCrmSeedRequest).toHaveBeenCalledWith({
      action: "listOrganizations",
      actor_account_id: "admin-1",
      payload: {
        reason: BASE.reason,
        limit: 25,
        source: "admin-ui",
      },
    });
  });

  it("keeps the authenticated actor separate from linked-account search", async () => {
    await searchOrganizations({
      ...BASE,
      query: "Example University",
      linked_account_id: "customer-account-1",
    });
    expect(mockDispatchCrmSeedRequest).toHaveBeenCalledWith({
      action: "searchOrganizations",
      actor_account_id: "admin-1",
      payload: {
        reason: BASE.reason,
        query: "Example University",
        linked_account_id: "customer-account-1",
        source: "admin-ui",
      },
    });
  });

  it("allows previews without fresh auth but requires it for commits", async () => {
    const request = {
      ...BASE,
      display_name: "Example University",
      organization_type: "university" as const,
    };
    await createOrganization(request);
    expect(mockRequireDangerousSessionAuth).not.toHaveBeenCalled();

    await createOrganization({
      ...request,
      commit: true,
      expected_version: 0,
      idempotency_key: "create-example",
    });
    expect(mockRequireDangerousSessionAuth).toHaveBeenCalledWith({
      account_id: "admin-1",
      browser_id: "browser-1",
      session_hash: "session-1",
      require_second_factor: "if_enabled",
      allow_actor_impersonation: false,
    });
  });

  it("requires fresh auth only when metrics are persisted as a snapshot", async () => {
    await getCustomerMetrics({
      ...BASE,
      organization: "CRM-2026-000001",
    });
    expect(mockRequireDangerousSessionAuth).not.toHaveBeenCalled();

    await getCustomerMetrics({
      ...BASE,
      organization: "CRM-2026-000001",
      refresh: true,
    });
    expect(mockRequireDangerousSessionAuth).toHaveBeenCalledWith({
      account_id: "admin-1",
      browser_id: "browser-1",
      session_hash: "session-1",
      require_second_factor: "if_enabled",
      allow_actor_impersonation: false,
    });
  });

  it("selects operation-specific integration capabilities", async () => {
    mockCrmActionCapabilities.mockReturnValue(["visible", "mutate", "zendesk"]);
    await mutateExternalReference({
      ...BASE,
      organization: "CRM-2026-000001",
      action: "add",
      provider: "zendesk",
      object_kind: "ticket",
      external_id: "20599",
    });
    expect(mockCrmActionCapabilities).toHaveBeenCalledWith(
      "mutateExternalReference",
      expect.objectContaining({ provider: "zendesk" }),
    );
    expect(mockAssertCrmCapability.mock.calls).toEqual([
      ["visible"],
      ["mutate"],
      ["zendesk"],
    ]);
  });

  it("routes non-seed requests only to the configured seed", async () => {
    const crm = jest.fn().mockResolvedValue({ organizations: [] });
    const bayOps = jest.fn(() => ({ crm }));
    mockGetConfiguredBayId.mockReturnValue("worker-bay");
    mockGetInterBayBridge.mockReturnValue({ bayOps });
    await listOrganizations(BASE as any);
    expect(mockDispatchCrmSeedRequest).not.toHaveBeenCalled();
    expect(bayOps).toHaveBeenCalledWith("seed-bay", { timeout_ms: 120_000 });
    expect(crm).toHaveBeenCalledWith({
      action: "listOrganizations",
      actor_account_id: "admin-1",
      payload: { reason: BASE.reason, source: "admin-ui" },
    });
  });

  it("does not dispatch a committed mutation when fresh auth fails", async () => {
    mockRequireDangerousSessionAuth.mockRejectedValue(
      Object.assign(Error("fresh auth required"), {
        code: "fresh_auth_required",
      }),
    );
    await expect(
      createOpportunity({
        ...BASE,
        organization: "CRM-2026-000001",
        name: "Adoption pilot",
        kind: "adoption_pilot",
        owner_account_id: "admin-1",
        expected_value: "3900",
        expected_close_date: "2026-09-30",
        commit: true,
        expected_version: 0,
        idempotency_key: "pilot-create",
      }),
    ).rejects.toMatchObject({ code: "fresh_auth_required" });
    expect(mockDispatchCrmSeedRequest).not.toHaveBeenCalled();
  });
});
