/** @jest-environment jsdom */

import {
  attachPublicNavigationInterceptor,
  setPublicNavigationListener,
} from "./navigation";
import { isPublicTarget } from "./routes";

describe("public navigation", () => {
  afterEach(() => {
    setPublicNavigationListener(undefined);
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  it("navigates internal public links without a full reload", () => {
    const seen: Array<[string, string]> = [];
    setPublicNavigationListener((pathname, search) => {
      seen.push([pathname, search]);
    });
    const detach = attachPublicNavigationInterceptor();
    document.body.innerHTML = '<a href="/about?x=1">About</a>';

    const link = document.querySelector("a")!;
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );

    expect(window.location.pathname).toBe("/about");
    expect(window.location.search).toBe("?x=1");
    expect(seen).toEqual([["/about", "?x=1"]]);
    detach();
  });

  it("intercepts the internal guides bridge page", () => {
    const seen: Array<[string, string]> = [];
    setPublicNavigationListener((pathname, search) => {
      seen.push([pathname, search]);
    });
    const detach = attachPublicNavigationInterceptor();
    document.body.innerHTML = '<a href="/guides">Guides</a>';

    const link = document.querySelector("a")!;
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );

    expect(window.location.pathname).toBe("/guides");
    expect(window.location.search).toBe("");
    expect(seen).toEqual([["/guides", ""]]);
    detach();
  });

  it("does not intercept non-public links", () => {
    const seen: Array<[string, string]> = [];
    setPublicNavigationListener((pathname, search) => {
      seen.push([pathname, search]);
    });
    const detach = attachPublicNavigationInterceptor();
    document.body.innerHTML = '<a href="/projects">Projects</a>';

    const link = document.querySelector("a")!;
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );

    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
    expect(seen).toEqual([]);
    detach();
  });
});

describe("isPublicTarget", () => {
  it("claims public sections by their first path segment only", () => {
    expect(isPublicTarget("/news")).toBe(true);
    expect(isPublicTarget("/news/some-post-42")).toBe(true);
    expect(isPublicTarget("/docs/admin/users")).toBe(true);
    expect(isPublicTarget("/de")).toBe(true);
    expect(isPublicTarget("/features/jupyter-notebook")).toBe(true);
  });

  it("does not claim app routes that merely contain a public section name", () => {
    // Admin news management links from the public news page must trigger a
    // full navigation into the webapp, not the public SPA router.
    expect(isPublicTarget("/admin/news")).toBe(false);
    expect(isPublicTarget("/admin/news/new")).toBe(false);
    expect(isPublicTarget("/settings/ai")).toBe(false);
    expect(isPublicTarget("/projects/docs")).toBe(false);
  });

  it("only treats the guides index as public", () => {
    expect(isPublicTarget("/guides")).toBe(true);
    expect(isPublicTarget("/guides/some-guide")).toBe(false);
  });
});
