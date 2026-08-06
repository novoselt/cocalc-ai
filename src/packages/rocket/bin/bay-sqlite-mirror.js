#!/usr/bin/env node

const path = require("node:path");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  if (!process.argv[index + 1]) throw new Error(`--${name} requires a value`);
  return process.argv[index + 1];
}

async function main() {
  const {
    refreshSqliteMirror,
  } = require("../../server/dist/bay-backup/sqlite-mirror.js");
  const sourceDir = option("source");
  const mirrorDir = option("mirror");
  if (!sourceDir || !mirrorDir) {
    throw new Error(
      "usage: bay-sqlite-mirror --source DIR --mirror DIR [--catalog FILE] [--concurrency N]",
    );
  }
  const catalogPath = option(
    "catalog",
    path.join(mirrorDir, ".cocalc-sqlite-mirror.json"),
  );
  const concurrency = Number(option("concurrency", "2"));
  const result = await refreshSqliteMirror({
    sourceDir,
    mirrorDir,
    catalogPath,
    concurrency,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((err) => {
  process.stderr.write(`bay SQLite mirror failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
