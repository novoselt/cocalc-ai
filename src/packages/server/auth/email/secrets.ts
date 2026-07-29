/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

import { getSecretSettingsKey } from "@cocalc/database/settings/secret-settings";

type EmailAuthSecretKind = "browser" | "code" | "email" | "ip" | "link";

let cachedKey: Buffer | undefined;

async function emailAuthKey(): Promise<Buffer> {
  if (cachedKey) {
    return cachedKey;
  }
  cachedKey = createHmac("sha256", await getSecretSettingsKey())
    .update("cocalc-email-auth:v1", "utf8")
    .digest();
  return cachedKey;
}

export async function emailAuthDigest({
  challenge_id,
  kind,
  value,
}: {
  challenge_id?: string;
  kind: EmailAuthSecretKind;
  value: string;
}): Promise<string> {
  return createHmac("sha256", await emailAuthKey())
    .update(kind, "utf8")
    .update("\0", "utf8")
    .update(`${challenge_id ?? ""}`, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}

export async function emailAuthSecretMatches(opts: {
  challenge_id?: string;
  digest: string;
  kind: EmailAuthSecretKind;
  value: string;
}): Promise<boolean> {
  const actual = Buffer.from(
    await emailAuthDigest({
      challenge_id: opts.challenge_id,
      kind: opts.kind,
      value: opts.value,
    }),
    "hex",
  );
  const expected = Buffer.from(opts.digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createEmailAuthCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function createEmailAuthLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createEmailAuthBrowserBinding(): string {
  return randomBytes(24).toString("base64url");
}

export function maskEmailAddress(email_address: string): string {
  const [local = "", domain = ""] = email_address.split("@");
  if (!local || !domain) {
    return "***";
  }
  const visible =
    local.length <= 2 ? local.slice(0, 1) : `${local.slice(0, 2)}…`;
  return `${visible}@${domain}`;
}

export function resetEmailAuthKeyForTesting(): void {
  cachedKey = undefined;
}
