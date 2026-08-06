#!/usr/bin/env node

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

"use strict";

const {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const { dirname, join } = require("node:path");

const root = __dirname;
const dist = join(root, "dist");

const PACKAGES = {
  codemirror: { source: "" },
  katex: { source: "dist" },
  "pdfjs-dist": { source: "cmaps", target: "cmaps" },
};

function packageRoot(name) {
  return dirname(require.resolve(`${name}/package.json`, { paths: [root] }));
}

function packageVersion(packageRoot) {
  return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
    .version;
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const versions = {};

for (const [name, subdirs] of Object.entries(PACKAGES)) {
  const root = packageRoot(name);
  const version = packageVersion(root);
  const source = subdirs.source ? join(root, subdirs.source) : root;
  const target = subdirs.target
    ? join(dist, name, subdirs.target)
    : join(dist, name);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, dereference: true });
  symlinkSync(name, join(dist, `${name}-${version}`), "dir");
  versions[name] = version;
  console.log(`copied ${name}@${version} from ${source}`);
}

const customThemes = join(root, "cm-custom-theme");
if (existsSync(customThemes)) {
  cpSync(customThemes, join(dist, "cm-custom-theme"), {
    recursive: true,
    dereference: true,
  });
  console.log(`copied custom themes from ${customThemes}`);
}

writeFileSync(
  join(dist, "index.js"),
  `"use strict";
exports.__esModule = true;
exports.versions = ${JSON.stringify(versions, null, 2)};
`,
);
