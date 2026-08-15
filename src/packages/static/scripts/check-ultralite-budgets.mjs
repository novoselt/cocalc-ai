#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
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

function assetSummary(chunkNames) {
  const assets = uniqueAssets(chunkNames);
  return {
    requests: assets.length,
    rawBytes: assets.reduce((sum, asset) => sum + asset.rawBytes, 0),
    gzipBytes: assets.reduce((sum, asset) => sum + asset.gzipBytes, 0),
    brotliBytes: assets.reduce((sum, asset) => sum + asset.brotliBytes, 0),
  };
}

const initial = findNamedGroup("ultralite");
if (!initial?.length) throw new Error("missing initial ultralite chunk group");
const projects = findNamedGroup("ultralite-projects");
const workspace = findNamedGroup("ultralite-workspace");
const files = findNamedGroup("ultralite-files");
const code = findNamedGroup("ultralite-code");
const notebookExecute = findNamedGroup("ultralite-notebook-execute");
const chat = findNamedGroup("ultralite-chat");
const vms = findNamedGroup("ultralite-vms");
const apps = findNamedGroup("ultralite-apps");
const cli = findNamedGroup("ultralite-cli");
const terminal = findNamedGroup("ultralite-terminal");
const prismLanguages = [
  "bash",
  "c",
  "cpp",
  "css",
  "javascript",
  "json",
  "latex",
  "markdown",
  "markup",
  "python",
  "rust",
  "sql",
  "typescript",
  "yaml",
].flatMap((language) => findNamedGroup(`ultralite-prism-${language}`));

const surfaces = [
  { label: "shell", chunks: initial, max: 75 * KiB },
  { label: "projects", chunks: [...initial, ...projects], max: 400 * KiB },
  {
    label: "files and read-only Jupyter",
    chunks: [...initial, ...workspace, ...files],
    max: 425 * KiB,
  },
  {
    label: "syntax-highlighted code",
    // Conservatively count every optional grammar even though a browser only
    // loads the grammar for the displayed file.
    chunks: [...initial, ...workspace, ...files, ...code, ...prismLanguages],
    max: 450 * KiB,
  },
  {
    label: "text and code editor",
    chunks: [...initial, ...workspace, ...files, ...code, ...prismLanguages],
    max: 500 * KiB,
  },
  {
    label: "executable Jupyter",
    chunks: [...initial, ...workspace, ...files, ...notebookExecute],
    max: 650 * KiB,
  },
  {
    label: "Codex chat",
    chunks: [...initial, ...workspace, ...chat],
    max: 550 * KiB,
  },
  {
    label: "VMs",
    chunks: [...initial, ...workspace, ...vms],
    max: 450 * KiB,
  },
  {
    label: "app servers",
    chunks: [...initial, ...workspace, ...apps],
    max: 475 * KiB,
  },
  {
    label: "CLI discovery",
    chunks: [...initial, ...workspace, ...cli],
    max: 425 * KiB,
  },
  {
    label: "terminal",
    chunks: [...initial, ...workspace, ...terminal],
    max: 500 * KiB,
  },
];

const forbidden = [
  "frontend/",
  "node_modules/.pnpm/antd@",
  "node_modules/.pnpm/@ant-design/",
  "node_modules/.pnpm/jquery@",
  "node_modules/.pnpm/redux@",
  "node_modules/.pnpm/immutable@",
  "node_modules/.pnpm/slate@",
  "node_modules/.pnpm/codemirror@",
  "node_modules/.pnpm/monaco-editor@",
  "node_modules/.pnpm/ace-builds@",
  "node_modules/.pnpm/prosemirror-",
  "node_modules/.pnpm/@jupyterlab/",
];

let failed = false;
const report = [];
for (const surface of surfaces) {
  const summary = assetSummary(surface.chunks);
  const bytes = summary.brotliBytes;
  report.push({ label: surface.label, limitBytes: surface.max, ...summary });
  console.log(
    `ultralite ${surface.label}: raw=${(summary.rawBytes / KiB).toFixed(1)} KiB gzip=${(summary.gzipBytes / KiB).toFixed(1)} KiB brotli=${(bytes / KiB).toFixed(1)} KiB requests=${summary.requests} limit=${(surface.max / KiB).toFixed(0)} KiB`,
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

writeFileSync(
  resolve(output, "ultralite-budget-report.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), surfaces: report }, null, 2)}\n`,
);

if (failed) process.exit(1);
