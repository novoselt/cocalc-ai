/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { act, renderHook, waitFor } from "@testing-library/react";

import { useMembershipSettingsData } from "../membership-settings-data";

const api = jest.fn();
const getClaimableMembershipPackages = jest.fn();
const getMembershipDetails = jest.fn();

jest.mock("@cocalc/frontend/app-framework", () => {
  const React = jest.requireActual("react");
  return {
    useTypedRedux: () => "account-1",
    useAsyncEffect: (effect: any, dependencies: unknown[]) => {
      React.useEffect(() => {
        let mounted = true;
        void effect(() => mounted);
        return () => {
          mounted = false;
        };
      }, dependencies);
    },
  };
});

jest.mock("@cocalc/frontend/client/api", () => ({
  __esModule: true,
  default: (...args: unknown[]) => api(...args),
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      hub: {
        purchases: {
          getMembershipDetails: (...args: unknown[]) =>
            getMembershipDetails(...args),
        },
      },
    },
  },
}));

jest.mock("@cocalc/frontend/purchases/api", () => ({
  getClaimableMembershipPackages: (...args: unknown[]) =>
    getClaimableMembershipPackages(...args),
}));

jest.mock("../membership-usage-events", () => ({
  dispatchMembershipDetailsRefreshed: jest.fn(),
}));

describe("useMembershipSettingsData refresh events", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "purchases/get-membership-tiers") {
        return { tiers: [] };
      }
      return { class: "free", source: "free" };
    });
    getMembershipDetails.mockResolvedValue({
      candidates: [],
      selected: { class: "free", source: "free" },
    });
    getClaimableMembershipPackages.mockResolvedValue([]);
  });

  it("reloads membership details when membership changes elsewhere", async () => {
    renderHook(() => useMembershipSettingsData());
    await waitFor(() => expect(getMembershipDetails).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new Event("cocalc:membership-changed"));
    });

    await waitFor(() => expect(getMembershipDetails).toHaveBeenCalledTimes(2));
  });
});
