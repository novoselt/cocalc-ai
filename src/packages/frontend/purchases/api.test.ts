/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const adminProvisionSiteLicense = jest.fn();
const updateSiteLicense = jest.fn();
const setAutoBalance = jest.fn();

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    browser_id: "browser-1",
    conat_client: {
      hub: {
        purchases: {
          adminProvisionSiteLicense: (...args: any[]) =>
            adminProvisionSiteLicense(...args),
          updateSiteLicense: (...args: any[]) => updateSiteLicense(...args),
          setAutoBalance: (...args: any[]) => setAutoBalance(...args),
        },
      },
    },
  },
}));

describe("purchases api", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes browser_id when provisioning a site license", async () => {
    adminProvisionSiteLicense.mockResolvedValue({ site_license: { id: "s1" } });
    const { adminProvisionSiteLicense: provision } = await import("./api");

    await provision({
      name: "Campus",
      organization_name: "Example University",
      allowed_domains: ["example.edu"],
      pools: [
        {
          pool_name: "Students",
          membership_class: "student",
          seat_count: 10,
          requires_approval: false,
          verification_policy: "email-domain",
        },
      ],
    });

    expect(adminProvisionSiteLicense).toHaveBeenCalledWith(
      expect.objectContaining({
        browser_id: "browser-1",
        name: "Campus",
      }),
    );
  });

  it("passes browser_id when updating a site license", async () => {
    updateSiteLicense.mockResolvedValue({ site_license: { id: "s1" } });
    const { updateSiteLicense: update } = await import("./api");

    await update({
      site_license_id: "s1",
      name: "Updated Campus",
    });

    expect(updateSiteLicense).toHaveBeenCalledWith({
      browser_id: "browser-1",
      site_license_id: "s1",
      name: "Updated Campus",
    });
  });

  it("passes browser_id when configuring automatic deposits", async () => {
    const config = {
      trigger: 10,
      amount: 20,
      max_day: 200,
      max_week: 1000,
      max_month: 2500,
      period: "week" as const,
      enabled: true,
    };
    setAutoBalance.mockResolvedValue(config);
    const { setAutoBalance: set } = await import("./api");

    await set(config);

    expect(setAutoBalance).toHaveBeenCalledWith({
      auto_balance: config,
      browser_id: "browser-1",
    });
  });
});
