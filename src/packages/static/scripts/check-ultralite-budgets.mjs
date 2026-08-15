#!/usr/bin/env node

import { readFileSync } from "fs";
import { resolve } from "path";

const KiB = 1024;
const output = resolve(
  process.cwd(),
  process.env.COCALC_OUTPUT || "dist-prod-measure",
);
const { chunks, groups } = JSON.parse(
  readFileSync(resolve(output, "chunk-stats.json"), "utf8"),
);

function findNamedGroup(name) {
  const matches = groups.filter((group) => group.name === name);
  if (matches.length !== 1) {
    throw new Error(
      `expected one '${name}' chunk group; found ${matches.length}`,
    );
  }
  return matches[0].chunks;
}

function uniqueAssets(chunkNames) {
  const assets = new Map();
  for (const name of new Set(chunkNames)) {
    const chunk = chunks[name];
    if (!chunk) throw new Error(`missing ultralite chunk '${name}'`);
    for (const asset of chunk.assets ?? []) assets.set(asset.file, asset);
  }
  return [...assets.values()];
}

function brotliBytes(chunkNames) {
  return uniqueAssets(chunkNames).reduce(
    (sum, asset) => sum + asset.brotliBytes,
    0,
  );
}

const initial = findNamedGroup("ultralite");
if (!initial?.length) throw new Error("missing initial ultralite chunk group");
const workspace = findNamedGroup("ultralite-workspace");
const files = findNamedGroup("ultralite-files");
const chat = findNamedGroup("ultralite-chat");

const surfaces = [
  { label: "shell", chunks: initial, max: 150 * KiB },
  { label: "projects", chunks: [...initial, ...workspace], max: 500 * KiB },
  {
    label: "files and read-only Jupyter",
    chunks: [...initial, ...workspace, ...files],
    max: 600 * KiB,
  },
  {
    label: "Codex chat",
    chunks: [...initial, ...workspace, ...chat],
    max: 750 * KiB,
  },
];

const forbidden = [
  "frontend/",
  "node_modules/.pnpm/antd@",
  "node_modules/.pnpm/@ant-design/",
  "node_modules/.pnpm/jquery@",
  "node_modules/.pnpm/redux@",
  "node_modules/.pnpm/slate@",
  "node_modules/.pnpm/codemirror@",
  "node_modules/.pnpm/@jupyterlab/",
];

let failed = false;
for (const surface of surfaces) {
  const bytes = brotliBytes(surface.chunks);
  console.log(
    `ultralite ${surface.label}: brotli=${(bytes / KiB).toFixed(1)} KiB limit=${(surface.max / KiB).toFixed(0)} KiB`,
  );
  if (bytes > surface.max) {
    failed = true;
    console.error(
      `ultralite ${surface.label} exceeds its Brotli budget by ${((bytes - surface.max) / KiB).toFixed(1)} KiB`,
    );
  }
  for (const chunkName of new Set(surface.chunks)) {
    for (const moduleName of Object.keys(chunks[chunkName]?.importers ?? {})) {
      const match = forbidden.find((pattern) => moduleName.includes(pattern));
      if (match) {
        failed = true;
        console.error(
          `ultralite ${surface.label} includes forbidden module '${moduleName}' via '${match}'`,
        );
      }
    }
  }
}

if (failed) process.exit(1);
