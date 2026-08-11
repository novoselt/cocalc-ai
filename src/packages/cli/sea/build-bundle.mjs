#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const seaDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(seaDir, "../../..");
const cliRoot = join(srcRoot, "packages", "cli");
const out = resolve(process.argv[2] || join(cliRoot, "build", "bundle"));
const entry = join(cliRoot, "dist", "bin", "cocalc.js");
const require = createRequire(join(cliRoot, "package.json"));
const ncc = require.resolve("@vercel/ncc/dist/ncc/cli.js");

function run(command, args, options = {}) {
  process.stdout.write(`+ ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: srcRoot,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with exit status ${result.status ?? "unknown"}`,
    );
  }
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
mkdirSync(out, { recursive: true });
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

run(pnpm, ["--dir", cliRoot, "build"]);
run(
  process.execPath,
  [ncc, "build", entry, "-o", out, "--minify", "--license", "licenses.txt"],
  {
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=8192"]
        .filter(Boolean)
        .join(" "),
    },
  },
);

const bundle = join(out, "index.js");
if (!existsSync(bundle)) {
  throw new Error(`bundle output is missing: ${bundle}`);
}
process.stdout.write(`Bundle ready: ${bundle}\n`);
