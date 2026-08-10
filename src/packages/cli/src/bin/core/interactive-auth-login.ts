/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { existsSync, realpathSync } from "node:fs";

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

export function isAccountAuthRequiredError(error: unknown): boolean {
  return `${(error as any)?.code ?? ""}` === "account_auth_required";
}

export function isFreshAuthRequiredError(error: unknown): boolean {
  const message = `${(error as any)?.message ?? error ?? ""}`.toLowerCase();
  return (
    `${(error as any)?.code ?? ""}` === "fresh_auth_required" ||
    message.includes("code='fresh_auth_required'")
  );
}

export function canOfferInteractiveProjectAccountBootstrap({
  error,
  env = process.env,
  stdinIsTTY = process.stdin.isTTY === true,
  stderrIsTTY = process.stderr.isTTY === true,
  secretMountExists,
}: {
  error: unknown;
  env?: NodeJS.ProcessEnv;
  stdinIsTTY?: boolean;
  stderrIsTTY?: boolean;
  secretMountExists?: (path: string) => boolean;
}): boolean {
  return Boolean(
    isAccountAuthRequiredError(error) &&
    stdinIsTTY &&
    stderrIsTTY &&
    isCoCalcProjectEnvironment(env, secretMountExists),
  );
}

export function canOfferInteractiveFreshAuth({
  error,
  stdinIsTTY = process.stdin.isTTY === true,
  stderrIsTTY = process.stderr.isTTY === true,
}: {
  error: unknown;
  stdinIsTTY?: boolean;
  stderrIsTTY?: boolean;
}): boolean {
  return Boolean(isFreshAuthRequiredError(error) && stdinIsTTY && stderrIsTTY);
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

export function interactiveAuthLoginEntrypoint({
  argvEntry = process.argv[1],
  execPath = process.execPath,
  sea = isSeaRuntime(),
}: {
  argvEntry?: string;
  execPath?: string;
  sea?: boolean;
} = {}): string | undefined {
  if (!argvEntry || sea) return undefined;
  try {
    // A SEA reached through a symlink can expose the symlink as argv[1] and
    // the versioned binary as execPath. Neither path is a JavaScript entrypoint.
    if (realpathSync(argvEntry) === realpathSync(execPath)) return undefined;
  } catch {
    // Normal JS entrypoints need not exist by the time this helper is called.
  }
  return argvEntry;
}

function isSeaRuntime(): boolean {
  try {
    const sea = require("node:sea") as { isSea?: () => boolean };
    return typeof sea?.isSea === "function" ? !!sea.isSea() : false;
  } catch {
    return false;
  }
}
