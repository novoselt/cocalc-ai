/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function inspectTranslationFile(path) {
  const messages = JSON.parse(readFileSync(path, "utf8"));
  const empty = [];
  const quoted = [];
  for (const [key, value] of Object.entries(messages)) {
    if (value === "") {
      empty.push(key);
    }
    if (typeof value === "string" && /(^|[^'])'[<{]/.test(value)) {
      quoted.push(key);
    }
  }
  return { empty, quoted };
}

function validateTranslations({
  languages,
  translationsDir = join(process.cwd(), "i18n", "trans"),
  writeError = (message) => process.stderr.write(message),
}) {
  let failed = false;
  for (const language of languages) {
    const { empty, quoted } = inspectTranslationFile(
      join(translationsDir, `${language}.json`),
    );
    if (empty.length) {
      writeError(
        `Error: empty translations in ${language}.json:\n${empty.join("\n")}\n`,
      );
      failed = true;
    }
    if (quoted.length) {
      writeError(
        `Error: apostrophe before '<' or '{' (starts an ICU quoted literal, breaks tags/placeholders) in ${language}.json:\n${quoted.join("\n")}\n`,
      );
      failed = true;
    }
  }
  if (failed) {
    writeError(
      "Fix the offending translations in SimpleLocalize (not locally, they would be overwritten), then download and compile again.\n",
    );
  }
  return !failed;
}

if (require.main === module) {
  const languages = process.argv.slice(2);
  if (!languages.length) {
    process.stderr.write("Usage: validate-translations.js <language>...\n");
    process.exit(2);
  }
  if (!validateTranslations({ languages })) {
    process.exit(1);
  }
}

module.exports = { inspectTranslationFile, validateTranslations };
