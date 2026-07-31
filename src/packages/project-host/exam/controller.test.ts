/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { scryptSync } from "node:crypto";
import { verifyExamTokenHash } from "./token";

function hashToken(token: string): string {
  const salt = Buffer.from("fixed-test-salt");
  const digest = scryptSync(token, salt, 32);
  return `scrypt-v1$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

describe("project-host local exam token", () => {
  it("accepts only the token matching the scrypt hash", () => {
    const encoded = hashToken("correct horse battery staple");
    expect(verifyExamTokenHash("correct horse battery staple", encoded)).toBe(
      true,
    );
    expect(verifyExamTokenHash("wrong token", encoded)).toBe(false);
  });

  it("rejects malformed token hashes without throwing", () => {
    expect(verifyExamTokenHash("token", "plaintext")).toBe(false);
    expect(verifyExamTokenHash("token", "scrypt-v1$bad$bad")).toBe(false);
  });
});
