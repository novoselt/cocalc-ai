import { fullProjectUrl, getAppBasePath, siteUrl } from "./urls";

test("detects root and prefixed static deployments", () => {
  expect(getAppBasePath("/static/ultralite.html")).toBe("");
  expect(getAppBasePath("/cocalc/static/ultralite.html")).toBe("/cocalc");
});

test("builds prefixed site and project URLs", () => {
  expect(siteUrl("api/v2/auth/bootstrap", "/cocalc")).toBe(
    "/cocalc/api/v2/auth/bootstrap",
  );
  expect(
    fullProjectUrl({
      projectId: "abc",
      path: "/home/user/a b.txt",
      basePath: "/cocalc",
    }),
  ).toBe("/cocalc/projects/abc/files/a%20b.txt");
});
