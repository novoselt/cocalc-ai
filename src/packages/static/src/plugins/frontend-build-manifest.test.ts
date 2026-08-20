import {
  frontendManifestAssets,
  isContentAddressedFrontendAsset,
} from "./frontend-build-assets";

test("recognizes safe content-addressed frontend assets", () => {
  expect(isContentAddressedFrontendAsset("app-0123456789abcdef.js")).toBe(true);
  expect(isContentAddressedFrontendAsset("fonts/0123456789abcdef.woff2")).toBe(
    true,
  );
  expect(isContentAddressedFrontendAsset("app.html")).toBe(false);
  expect(isContentAddressedFrontendAsset("../0123456789abcdef.js")).toBe(false);
  expect(isContentAddressedFrontendAsset("/0123456789abcdef.js")).toBe(false);
});

test("records every emitted content-addressed asset in stable order", () => {
  expect(
    frontendManifestAssets({
      getAssets: () => [
        { name: "frontend-build.json" },
        { name: "app-fedcba9876543210.js" },
        { name: "0123456789abcdef.css" },
      ],
    }),
  ).toEqual(["0123456789abcdef.css", "app-fedcba9876543210.js"]);
});
