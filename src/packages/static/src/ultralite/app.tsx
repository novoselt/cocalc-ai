/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { lazy, Suspense, useEffect, useState } from "react";
import { getAuthBootstrap, type AuthBootstrap } from "./api";
import { ultraliteTheme } from "./theme";
import { siteUrl } from "./urls";
import { TopBar } from "./ui";

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

  useEffect(() => {
    const controller = new AbortController();
    void getAuthBootstrap(controller.signal)
      .then(setBootstrap)
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : `${err}`);
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="ul-app" style={ultraliteTheme}>
      <a className="ul-skip" href="#main-content">
        Skip to content
      </a>
      {bootstrap?.signed_in ? null : <TopBar />}
      {error ? (
        <main className="ul-centered" id="main-content">
          <h1>Ultralite could not start</h1>
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
            Ultralite uses your existing CoCalc account and project permissions.
          </p>
          <a className="ul-link-button" href={siteUrl("app")}>
            Open CoCalc to sign in
          </a>
        </main>
      ) : (
        <Suspense fallback={<Loading message="Connecting to your home bay" />}>
          <Workspace bootstrap={bootstrap} />
        </Suspense>
      )}
    </div>
  );
}
