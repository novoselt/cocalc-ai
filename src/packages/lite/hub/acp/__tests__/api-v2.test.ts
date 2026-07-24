import { isApiV2Enabled } from "../../../api-v2";

describe("Lite API v2 mode", () => {
  it("is disabled for standalone Lite by default", () => {
    expect(isApiV2Enabled({})).toBe(false);
  });

  it("is enabled for the restricted Launchpad manifest", () => {
    expect(
      isApiV2Enabled({
        COCALC_LAUNCHPAD_API_V2_ROUTES: "1",
      }),
    ).toBe(true);
  });

  it("supports explicit standalone opt-in and opt-out", () => {
    expect(isApiV2Enabled({ COCALC_LITE_API_V2: "yes" })).toBe(true);
    expect(
      isApiV2Enabled({
        COCALC_LITE_API_V2: "off",
        COCALC_LAUNCHPAD_API_V2_ROUTES: "1",
      }),
    ).toBe(false);
  });

  it("keeps CoCalc Plus disabled", () => {
    expect(
      isApiV2Enabled({
        COCALC_PRODUCT: "plus",
        COCALC_LITE_API_V2: "1",
      }),
    ).toBe(false);
  });
});
