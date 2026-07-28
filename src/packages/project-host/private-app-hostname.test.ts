/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  createPrivateAppHostnameRequestRewriter,
  privateAppHostnameExternalLocation,
  PRIVATE_APP_HOST_HEADER,
  rewritePrivateAppHostnameResponseLocation,
  rewritePrivateAppHostnameUrl,
} from "./private-app-hostname";

const route = {
  project_id: "11111111-1111-4111-8111-111111111111",
  app_id: "dev-site",
  base_path: "/apps/dev-site",
};

describe("private app hostname routing", () => {
  it("maps hostname-root requests to the private managed app", () => {
    expect(
      rewritePrivateAppHostnameUrl({
        originalUrl: "/auth/sign-in?next=%2F",
        route,
      }),
    ).toBe(
      "/11111111-1111-4111-8111-111111111111/apps/dev-site/auth/sign-in?next=%2F",
    );
  });

  it("preserves the hostname-root trailing slash", () => {
    expect(
      rewritePrivateAppHostnameUrl({
        originalUrl: "/",
        route,
      }),
    ).toBe(`/${route.project_id}/apps/dev-site/`);
    expect(
      rewritePrivateAppHostnameUrl({
        originalUrl: "/docs/",
        route,
      }),
    ).toBe(`/${route.project_id}/apps/dev-site/docs/`);
  });

  it("does not duplicate an already canonical route", () => {
    expect(
      rewritePrivateAppHostnameUrl({
        originalUrl:
          "/11111111-1111-4111-8111-111111111111/apps/dev-site/api/status",
        route,
      }),
    ).toBe("/11111111-1111-4111-8111-111111111111/apps/dev-site/api/status");
  });

  it("traces, caches, marks, and rewrites private hostname requests", async () => {
    const trace = jest.fn(async () => ({ matched: true, ...route }));
    const rewrite = createPrivateAppHostnameRequestRewriter({ trace });
    const first = {
      headers: { host: "DEV-1234.EXAMPLE.COM:443" },
      url: "/auth/sign-in?next=%2F",
    } as any;
    const second = {
      headers: { host: "dev-1234.example.com" },
      url: "/api/status",
    } as any;

    await rewrite(first);
    await rewrite(second);

    expect(trace).toHaveBeenCalledTimes(1);
    expect(trace).toHaveBeenCalledWith("dev-1234.example.com");
    expect(first.headers[PRIVATE_APP_HOST_HEADER]).toBe("dev-1234.example.com");
    expect(first.url).toBe(
      "/11111111-1111-4111-8111-111111111111/apps/dev-site/auth/sign-in?next=%2F",
    );
    expect(second.url).toBe(
      "/11111111-1111-4111-8111-111111111111/apps/dev-site/api/status",
    );
  });

  it("leaves canonical project-host routes unchanged", async () => {
    const trace = jest.fn();
    const rewrite = createPrivateAppHostnameRequestRewriter({ trace });
    const req = {
      headers: { host: "dev-1234.example.com" },
      url: `/${route.project_id}/apps/dev-site/`,
    } as any;

    await rewrite(req);

    expect(trace).not.toHaveBeenCalled();
    expect(req.url).toBe(`/${route.project_id}/apps/dev-site/`);
    expect(req.headers[PRIVATE_APP_HOST_HEADER]).toBeUndefined();
  });

  it("maps internal redirect locations back to the private hostname root", async () => {
    const rewrite = createPrivateAppHostnameRequestRewriter({
      trace: async () => ({ matched: true, ...route }),
    });
    const req = {
      headers: { host: "dev-1234.example.com" },
      url: "/",
    } as any;
    await rewrite(req);

    expect(
      privateAppHostnameExternalLocation(
        req,
        `/${route.project_id}/apps/dev-site`,
      ),
    ).toBe("/");
    expect(
      privateAppHostnameExternalLocation(
        req,
        `/${route.project_id}/apps/dev-site/static/app.html?target=%2Fprojects`,
      ),
    ).toBe("/static/app.html?target=%2Fprojects");
    expect(
      privateAppHostnameExternalLocation(
        req,
        "https://other.example.com/11111111-1111-4111-8111-111111111111/apps/dev-site/",
      ),
    ).toBe(
      "https://other.example.com/11111111-1111-4111-8111-111111111111/apps/dev-site/",
    );

    const proxyRes = {
      headers: {
        location: `/${route.project_id}/apps/dev-site/auth/sign-in`,
      },
    } as any;
    rewritePrivateAppHostnameResponseLocation(proxyRes, req);
    expect(proxyRes.headers.location).toBe("/auth/sign-in");
  });
});
