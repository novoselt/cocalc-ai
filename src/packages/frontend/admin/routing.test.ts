import { fromJS } from "immutable";

import {
  getAdminTargetPath,
  normalizeAdminRoute,
  parseAdminRoute,
} from "./routing";

describe("admin routing", () => {
  it("parses news editor routes", () => {
    expect(parseAdminRoute("admin/news/new")).toEqual({
      kind: "news-editor",
      id: "new",
    });
    expect(parseAdminRoute("admin/site-settings")).toEqual({
      kind: "index",
      section: "site-settings",
    });
    expect(parseAdminRoute("admin/site-setup")).toEqual({
      kind: "index",
      section: "site-setup",
    });
    expect(parseAdminRoute("admin/site-license-claims")).toEqual({
      kind: "index",
      section: "site-license-claims",
    });
    expect(parseAdminRoute("admin/managed-cpu")).toEqual({
      kind: "index",
      section: "managed-cpu",
    });
    expect(parseAdminRoute("admin/usage-stats")).toEqual({
      kind: "index",
      section: "usage-stats",
    });
    expect(parseAdminRoute("admin/retention")).toEqual({
      kind: "index",
      section: "retention",
    });
    expect(parseAdminRoute("admin/active-users")).toEqual({
      kind: "index",
      section: "active-users",
    });
    expect(parseAdminRoute("admin/revenue-analytics")).toEqual({
      kind: "index",
      section: "revenue-analytics",
    });
    expect(parseAdminRoute("admin/codex-pools")).toEqual({
      kind: "index",
      section: "codex-pools",
    });
    expect(parseAdminRoute("admin/receivables")).toEqual({
      kind: "index",
      section: "receivables",
    });
    expect(parseAdminRoute("admin/receivables/AR-2026-000123")).toEqual({
      kind: "receivables-detail",
      id: "AR-2026-000123",
    });
    expect(parseAdminRoute("admin/receivables/new")).toEqual({
      kind: "receivables-create",
    });
    expect(parseAdminRoute("admin/customers")).toEqual({
      kind: "index",
      section: "customers",
    });
    expect(parseAdminRoute("admin/customers/customer-id")).toEqual({
      kind: "customer-detail",
      id: "customer-id",
    });
    expect(parseAdminRoute("admin/site-licenses/license-id")).toEqual({
      kind: "site-license-detail",
      id: "license-id",
    });
    expect(getAdminTargetPath({ kind: "index", section: "user-search" })).toBe(
      "admin/user-search",
    );
  });

  it("serializes receivables detail routes", () => {
    expect(
      getAdminTargetPath({
        kind: "receivables-detail",
        id: "AR-2026-000123",
      }),
    ).toBe("admin/receivables/AR-2026-000123");
    expect(getAdminTargetPath({ kind: "receivables-create" })).toBe(
      "admin/receivables/new",
    );
  });

  it("serializes customer detail routes", () => {
    expect(
      getAdminTargetPath({ kind: "customer-detail", id: "customer/id" }),
    ).toBe("admin/customers/customer%2Fid");
  });

  it("serializes site license detail routes", () => {
    expect(
      getAdminTargetPath({
        kind: "site-license-detail",
        id: "license/id",
      }),
    ).toBe("admin/site-licenses/license%2Fid");
  });

  it("normalizes immutable admin routes from redux state", () => {
    const route = fromJS({ kind: "news-editor", id: "new" });
    expect(normalizeAdminRoute(route)).toEqual({
      kind: "news-editor",
      id: "new",
    });
    expect(getAdminTargetPath(route)).toBe("admin/news/new");
  });
});
