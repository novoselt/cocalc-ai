import assert from "node:assert/strict";
import test from "node:test";

import {
  canOfferInteractiveAuthLogin,
  interactiveAuthLoginArgs,
  isCoCalcProjectEnvironment,
  isMissingCookieAuthError,
} from "./interactive-auth-login";

const COOKIE_ERROR =
  "failed to sign in - Error: no auth cookie set; set remember_me";

test("recognizes missing cookie authentication failures", () => {
  assert.equal(isMissingCookieAuthError(new Error(COOKIE_ERROR)), true);
  assert.equal(isMissingCookieAuthError(new Error("permission denied")), false);
});

test("allows automatic browser login only for an interactive human-readable command", () => {
  assert.equal(
    canOfferInteractiveAuthLogin({
      error: new Error(COOKIE_ERROR),
      globals: {},
      env: {},
      stdinIsTTY: true,
      stderrIsTTY: true,
      secretMountExists: () => false,
    }),
    true,
  );
  assert.equal(
    canOfferInteractiveAuthLogin({
      error: new Error(COOKIE_ERROR),
      globals: { json: true },
      env: {},
      stdinIsTTY: true,
      stderrIsTTY: true,
      secretMountExists: () => false,
    }),
    false,
  );
  assert.equal(
    canOfferInteractiveAuthLogin({
      error: new Error(COOKIE_ERROR),
      globals: {},
      env: {},
      stdinIsTTY: false,
      stderrIsTTY: true,
      secretMountExists: () => false,
    }),
    false,
  );
});

test("never starts account login from inside a CoCalc project", () => {
  assert.equal(
    isCoCalcProjectEnvironment(
      { COCALC_RUNTIME_HOME: "/home/user" },
      () => false,
    ),
    true,
  );
  assert.equal(
    canOfferInteractiveAuthLogin({
      error: new Error(COOKIE_ERROR),
      globals: {},
      env: { COCALC_PROJECT_ID: "project-1" },
      stdinIsTTY: true,
      stderrIsTTY: true,
      secretMountExists: () => false,
    }),
    false,
  );
});

test("preserves profile and api when launching browser login", () => {
  assert.deepEqual(
    interactiveAuthLoginArgs({
      globals: {
        profile: "production",
        api: "https://cocalc.ai",
      },
      entrypoint: "/opt/cocalc/bin2/cocalc-cli.js",
    }),
    [
      "/opt/cocalc/bin2/cocalc-cli.js",
      "--profile",
      "production",
      "--api",
      "https://cocalc.ai",
      "auth",
      "login",
    ],
  );
});

test("supports a standalone executable without a JavaScript entrypoint", () => {
  assert.deepEqual(
    interactiveAuthLoginArgs({
      globals: { api: "https://cocalc.ai" },
    }),
    ["--api", "https://cocalc.ai", "auth", "login"],
  );
});
