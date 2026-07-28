/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateTranslations } = require("./validate-translations");

test("accepts valid translation messages", () => {
  const dir = mkdtempSync(join(tmpdir(), "cocalc-i18n-"));
  try {
    writeFileSync(
      join(dir, "fr_FR.json"),
      JSON.stringify({ hello: "Bonjour", count: "{count} fichiers" }),
    );
    assert.equal(
      validateTranslations({
        languages: ["fr_FR"],
        translationsDir: dir,
      }),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("reports empty and ICU-quoted translations", () => {
  const dir = mkdtempSync(join(tmpdir(), "cocalc-i18n-"));
  const errors = [];
  try {
    writeFileSync(
      join(dir, "it_IT.json"),
      JSON.stringify({
        empty: "",
        markup: "dell'<name>",
        escaped: "dell’<name>",
      }),
    );
    assert.equal(
      validateTranslations({
        languages: ["it_IT"],
        translationsDir: dir,
        writeError: (message) => errors.push(message),
      }),
      false,
    );
    assert.match(errors.join(""), /empty translations.*empty/s);
    assert.match(errors.join(""), /apostrophe.*markup/s);
    assert.doesNotMatch(errors.join(""), /escaped/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
