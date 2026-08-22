/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { egressRateLabel, providerEgressIsFree } from "./compute-vms-egress";

describe("managed compute egress labels", () => {
  it("does not describe site-funded GCP egress as free", () => {
    expect(providerEgressIsFree("gcp")).toBe(false);
    expect(
      egressRateLabel({ provider: "gcp", funding_mode: "site-funded" }),
    ).toBe("Egress $0.10/GB · paid by site");
  });

  it("shows account-funded GCP egress pricing", () => {
    expect(
      egressRateLabel({
        provider: "gcp",
        funding_mode: "account-prepaid",
      }),
    ).toBe("Egress $0.10/GB");
  });

  it("shows Nebius provider egress as free", () => {
    expect(providerEgressIsFree("nebius")).toBe(true);
    expect(
      egressRateLabel({
        provider: "nebius",
        funding_mode: "account-prepaid",
      }),
    ).toBe("Egress is free");
  });
});
