#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const seaDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(seaDir, "../../..");
const cliRoot = join(srcRoot, "packages", "cli");
const buildDir = join(cliRoot, "build", "sea");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--") || !argv[i + 1]) {
      throw new Error(`invalid argument: ${arg}`);
    }
    args[arg.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function run(command, args, options = {}) {
  process.stdout.write(`+ ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
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

function releasePlatform() {
  const arch =
    process.arch === "x64"
      ? "amd64"
      : process.arch === "arm64"
        ? "arm64"
        : undefined;
  const machine =
    process.arch === "x64"
      ? "x86_64"
      : process.arch === "arm64" && process.platform === "linux"
        ? "aarch64"
        : process.arch;
  const os = process.platform === "win32" ? "windows" : process.platform;
  if (
    !arch ||
    !["linux", "darwin", "windows"].includes(os) ||
    (os === "windows" && arch !== "amd64")
  ) {
    throw new Error(`unsupported SEA build platform: ${os}/${process.arch}`);
  }
  return { arch, machine, os };
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== 26) {
  throw new Error(
    `CoCalc CLI SEA builds require Node.js 26; got ${process.version} at ${process.execPath}`,
  );
}
if (process.config.variables.single_executable_application === false) {
  throw new Error(
    `Node.js at ${process.execPath} was built without SEA support; use the official Node.js 26 distribution (Homebrew disables SEA)`,
  );
}

const args = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(
  readFileSync(join(cliRoot, "package.json"), "utf8"),
);
const releaseId =
  args["release-id"] ||
  process.env.COCALC_SOFTWARE_ARTIFACT_ID ||
  process.env.npm_package_version ||
  packageJson.version;
const bundle = resolve(
  args.bundle || join(cliRoot, "build", "bundle", "index.js"),
);
if (!args.bundle) {
  run(process.execPath, [join(seaDir, "build-bundle.mjs")]);
}
if (!existsSync(bundle)) throw new Error(`missing CLI bundle: ${bundle}`);

const { arch, machine, os } = releasePlatform();
const extension = os === "windows" ? ".exe" : "";
const target = join(
  buildDir,
  `cocalc-cli-${releaseId}-${machine}-${os}${extension}`,
);
const configPath = join(buildDir, `sea-config-${process.pid}.json`);
mkdirSync(buildDir, { recursive: true });
rmSync(target, { force: true });
writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      main: bundle,
      output: target,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
    },
    null,
    2,
  )}\n`,
);

try {
  process.stdout.write(
    `Building CoCalc CLI SEA ${releaseId} for ${os}/${arch} with ${process.version}\n`,
  );
  run(process.execPath, ["--build-sea", configPath], { cwd: buildDir });
  if (os !== "windows") chmodSync(target, 0o755);

  const signId = process.env.COCALC_CLI_SIGN_ID?.trim();
  const requireDeveloperId =
    process.env.COCALC_CLI_REQUIRE_DEVELOPER_ID === "1";
  if (os === "darwin") {
    if (requireDeveloperId && !signId) {
      throw new Error("release build requires COCALC_CLI_SIGN_ID");
    }
    const signArgs = ["--force", "--sign", signId || "-"];
    if (signId) {
      signArgs.push(
        "--timestamp",
        "--options",
        "runtime",
        "--entitlements",
        resolve(
          process.env.COCALC_CLI_ENTITLEMENTS ||
            join(seaDir, "entitlements.plist"),
        ),
      );
    }
    signArgs.push(target);
    run("codesign", signArgs);
  }

  let artifact = target;
  if (os === "linux") {
    artifact = `${target}.tar.gz`;
    run(join(seaDir, "package-linux-runtime.sh"), [target, artifact]);
  }

  const stable = join(buildDir, os === "windows" ? "cocalc.exe" : "cocalc-cli");
  rmSync(stable, { force: true });
  if (os === "windows") {
    copyFileSync(target, stable);
  } else {
    symlinkSync(basename(target), stable);
  }

  const verifyArgs = [
    join(seaDir, "verify-release-artifact.mjs"),
    "--file",
    artifact,
    "--os",
    os,
    "--arch",
    arch,
    "--release-id",
    releaseId,
    "--execute",
  ];
  if (os === "darwin" && signId) verifyArgs.push("--require-developer-id");
  run(process.execPath, verifyArgs);
  process.stdout.write(`Built ${artifact}\n`);
} finally {
  rmSync(configPath, { force: true });
}
