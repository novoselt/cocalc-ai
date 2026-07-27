import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  canOfferInteractiveAuthLogin,
  interactiveAuthLoginArgs,
  interactiveAuthLoginEntrypoint,
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

test("does not pass a symlinked standalone executable as a script", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cocalc-cli-login-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const versionedBinary = join(dir, "versions", "1", "cocalc");
  const installedLink = join(dir, "bin", "cocalc");
  mkdirSync(dirname(versionedBinary), { recursive: true });
  mkdirSync(dirname(installedLink), { recursive: true });
  writeFileSync(versionedBinary, "");
  symlinkSync(versionedBinary, installedLink);

  assert.equal(
    interactiveAuthLoginEntrypoint({
      argvEntry: installedLink,
      execPath: versionedBinary,
      sea: false,
    }),
    undefined,
  );
});

test("keeps a JavaScript CLI entrypoint when running under node", () => {
  assert.equal(
    interactiveAuthLoginEntrypoint({
      argvEntry: "/opt/cocalc/bin2/cocalc-cli.js",
      execPath: "/opt/cocalc/bin/node",
      sea: false,
    }),
    "/opt/cocalc/bin2/cocalc-cli.js",
  );
  assert.equal(
    interactiveAuthLoginEntrypoint({
      argvEntry: "/home/user/.local/share/cocalc/bin/cocalc",
      execPath: "/home/user/.local/share/cocalc/versions/1/cocalc",
      sea: true,
    }),
    undefined,
  );
});
