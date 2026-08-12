#!/usr/bin/env node

import { readFileSync } from "fs";
import { resolve } from "path";

const outputDir = resolve(
  process.cwd(),
  process.env.COCALC_OUTPUT || "dist-prod-measure",
);
const { chunks } = JSON.parse(
  readFileSync(resolve(outputDir, "chunk-stats.json"), "utf8"),
);
const limit = Number.parseInt(process.env.LIMIT ?? "40", 10);

for (const chunkName of ["load", "app"]) {
  const chunk = chunks[chunkName];
  if (chunk == null) throw new Error(`missing chunk stats for ${chunkName}`);
  console.log(`\n${chunkName}: largest source modules`);
  const sorted = Object.entries(chunk.moduleRawBytes ?? {}).sort(
    ([, a], [, b]) => b - a,
  );
  for (const [module, bytes] of sorted.slice(0, limit)) {
    console.log(
      `${`${(bytes / 1024).toFixed(1)} KiB`.padStart(11)}  ${module}`,
    );
  }
}
