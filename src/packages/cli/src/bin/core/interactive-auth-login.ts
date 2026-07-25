/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { existsSync } from "node:fs";

type InteractiveAuthGlobals = {
  json?: boolean;
  output?: "table" | "json" | "yaml";
  quiet?: boolean;
  profile?: string;
  api?: string;
};

export function isMissingCookieAuthError(error: unknown): boolean {
  const message = `${(error as any)?.message ?? error ?? ""}`.toLowerCase();
  return (
    message.includes("no auth cookie set") ||
    message.includes("no remember_me cookie set") ||
    message.includes("cookie-backed session")
  );
}

export function isCoCalcProjectEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  secretMountExists: (path: string) => boolean = existsSync,
): boolean {
  return Boolean(
    env.COCALC_PROJECT_ID ||
    env.COCALC_RUNTIME_HOME ||
    env.COCALC_PROXY_PORT ||
    secretMountExists("/run/secrets/cocalc"),
  );
}

export function canOfferInteractiveAuthLogin({
  error,
  globals,
  env = process.env,
  stdinIsTTY = process.stdin.isTTY === true,
  stderrIsTTY = process.stderr.isTTY === true,
  secretMountExists,
}: {
  error: unknown;
  globals: InteractiveAuthGlobals;
  env?: NodeJS.ProcessEnv;
  stdinIsTTY?: boolean;
  stderrIsTTY?: boolean;
  secretMountExists?: (path: string) => boolean;
}): boolean {
  if (
    globals.json ||
    globals.output === "json" ||
    globals.quiet ||
    !stdinIsTTY ||
    !stderrIsTTY ||
    !isMissingCookieAuthError(error)
  ) {
    return false;
  }
  return !isCoCalcProjectEnvironment(env, secretMountExists);
}

export function interactiveAuthLoginArgs({
  globals,
  entrypoint,
}: {
  globals: InteractiveAuthGlobals;
  entrypoint?: string;
}): string[] {
  const args = entrypoint ? [entrypoint] : [];
  if (globals.profile) {
    args.push("--profile", globals.profile);
  }
  if (globals.api) {
    args.push("--api", globals.api);
  }
  args.push("auth", "login");
  return args;
}
