import {
  isCanonicalPublicSiteHost,
  isCocalcAiOnlyPublicPath,
  isCocalcAiOnlyPublicSection,
  isLockedDownPublicSiteHost,
  normalizePublicSiteHost,
} from "./public-site-policy";

test("normalizes public-site hosts", () => {
  expect(normalizePublicSiteHost("https://CoCalc.AI:443/path")).toBe(
    "cocalc.ai",
  );
  expect(normalizePublicSiteHost("[::1]:9100")).toBe("::1");
});

test("distinguishes the canonical, locked-down, and branded hosts", () => {
  expect(isCanonicalPublicSiteHost("cocalc.ai")).toBe(true);
  expect(isCanonicalPublicSiteHost("dev123.cocalc.ai")).toBe(false);
  expect(isLockedDownPublicSiteHost("dev123.cocalc.ai")).toBe(true);
  expect(isLockedDownPublicSiteHost("localhost:9100")).toBe(true);
  expect(isLockedDownPublicSiteHost("university.example.edu")).toBe(false);
});

test("identifies marketing routes reserved for cocalc.ai", () => {
  expect(isCocalcAiOnlyPublicPath("/features/jupyter-notebook")).toBe(true);
  expect(isCocalcAiOnlyPublicPath("/pricing")).toBe(true);
  expect(isCocalcAiOnlyPublicPath("/news")).toBe(false);
  expect(isCocalcAiOnlyPublicPath("/about-face")).toBe(false);
  expect(isCocalcAiOnlyPublicSection("products")).toBe(true);
  expect(isCocalcAiOnlyPublicSection("docs")).toBe(false);
});
