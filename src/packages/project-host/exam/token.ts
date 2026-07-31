/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { scryptSync, timingSafeEqual } from "node:crypto";

export function verifyExamTokenHash(token: string, encoded: string): boolean {
  const [scheme, saltEncoded, digestEncoded] = encoded.split("$");
  if (scheme !== "scrypt-v1" || !saltEncoded || !digestEncoded) return false;
  try {
    const salt = Buffer.from(saltEncoded, "base64url");
    const expected = Buffer.from(digestEncoded, "base64url");
    const actual = scryptSync(token, salt, expected.length);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}
