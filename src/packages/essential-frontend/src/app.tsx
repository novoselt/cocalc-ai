/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { lazy, Suspense, useEffect, useState } from "react";
import { getAuthBootstrap, type AuthBootstrap } from "./api";
import {
  ESSENTIAL_ROUTE_CHANGE,
  essentialRouteUrl,
  parseRoute,
  type UltraliteRoute,
} from "./routes";
import { EssentialThemeProvider } from "./theme-context";
import { FrontendUpdateNotice } from "./frontend-update";
import { siteUrl } from "./urls";
import { TopBar } from "./ui";
import {
  markUltraliteBackend,
  recordUltraliteOutcome,
  recordUltraliteSurfaceReady,
} from "./telemetry";

const Workspace = lazy(
  () =>
    new Promise((resolve, reject) => {
      // The static package compiles to CommonJS, so native import() would be
      // rewritten to require(). Keep this explicit Rspack split point.
      require.ensure(
        [],
        () => resolve(require("./workspace")),
        reject,
        "ultralite-workspace",
      );
    }),
);
const ProjectsWorkspace = lazy(
  () =>
    new Promise((resolve, reject) => {
      require.ensure(
        [],
        () => resolve(require("./projects-workspace")),
        reject,
        "ultralite-projects",
      );
    }),
);
const NotificationsSurface = lazy(
  () =>
    new Promise((resolve, reject) => {
      require.ensure(
        [],
        () => resolve(require("./notifications-surface")),
        reject,
        "ultralite-notifications",
      );
    }),
);

function Loading({ message }: { message: string }) {
  return (
    <main className="ul-centered" id="main-content">
      <h1>{message}</h1>
      <div aria-hidden="true" className="ul-progress-track">
        <span />
      </div>
    </main>
  );
}

export function UltraliteApp() {
  const [bootstrap, setBootstrap] = useState<AuthBootstrap>();
  const [error, setError] = useState<string>();
  const [route, setRoute] = useState<UltraliteRoute>(() => parseRoute());

  useEffect(() => {
    const controller = new AbortController();
    markUltraliteBackend("shell", "start");
    void getAuthBootstrap(controller.signal)
      .then((value) => {
        markUltraliteBackend("shell", "end");
        setBootstrap(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          markUltraliteBackend("shell", "end");
          recordUltraliteOutcome("shell", "auth_failure");
          setError(err instanceof Error ? err.message : `${err}`);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (bootstrap?.signed_in) recordUltraliteSurfaceReady("shell");
  }, [bootstrap?.signed_in]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.(
        "a[data-ul-full-cocalc]",
      );
      if (anchor) {
        recordUltraliteOutcome("shell", "full_cocalc");
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    const onRouteChange = () => setRoute(parseRoute());
    const initialRoute = parseRoute();
    const canonicalUrl = essentialRouteUrl(initialRoute);
    if (
      `${window.location.pathname}${window.location.search}` !== canonicalUrl ||
      window.location.hash
    ) {
      window.history.replaceState({}, "", canonicalUrl);
    }
    setRoute(initialRoute);
    window.addEventListener("popstate", onRouteChange);
    window.addEventListener(ESSENTIAL_ROUTE_CHANGE, onRouteChange);
    return () => {
      window.removeEventListener("popstate", onRouteChange);
      window.removeEventListener(ESSENTIAL_ROUTE_CHANGE, onRouteChange);
    };
  }, []);

  return (
    <EssentialThemeProvider>
      <a className="ul-skip" href="#main-content">
        Skip to content
      </a>
      {bootstrap?.signed_in ? <FrontendUpdateNotice /> : null}
      {bootstrap?.signed_in ? null : <TopBar />}
      {error ? (
        <main className="ul-centered" id="main-content">
          <h1>Essential CoCalc could not start</h1>
          <p className="ul-error" role="alert">
            {error}
          </p>
          <button
            className="ul-button"
            onClick={() => window.location.reload()}
            type="button"
          >
            Try again
          </button>
        </main>
      ) : bootstrap == null ? (
        <Loading message="Checking your CoCalc session" />
      ) : !bootstrap.signed_in ||
        !bootstrap.account_id ||
        !bootstrap.home_bay_url ? (
        <main className="ul-centered" id="main-content">
          <h1>Sign in to continue</h1>
          <p>
            Essential CoCalc uses your existing account and project permissions.
          </p>
          <a
            className="ul-link-button"
            data-ul-full-cocalc
            href={siteUrl("app")}
          >
            Open CoCalc to sign in
          </a>
        </main>
      ) : (
        <Suspense fallback={<Loading message="Loading CoCalc" />}>
          {route.kind === "projects" ? (
            <ProjectsWorkspace bootstrap={bootstrap} />
          ) : route.kind === "notifications" ? (
            <NotificationsSurface bootstrap={bootstrap} />
          ) : (
            <Workspace bootstrap={bootstrap} route={route} />
          )}
        </Suspense>
      )}
    </EssentialThemeProvider>
  );
}
