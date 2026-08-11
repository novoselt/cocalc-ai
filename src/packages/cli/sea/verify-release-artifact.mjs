#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--execute" || arg === "--require-developer-id") {
      args[arg.slice(2)] = true;
      continue;
    }
    if (!arg.startsWith("--") || !argv[i + 1]) {
      fail(`invalid argument: ${arg}`);
    }
    args[arg.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function requiredString(args, name) {
  const value = `${args[name] ?? ""}`.trim();
  if (!value) fail(`missing --${name}`);
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed with exit status ${result.status}: ${result.stderr?.trim() || result.stdout?.trim() || "no output"}`,
    );
  }
  return result;
}

function expectedFilename({ os, arch, releaseId }) {
  const machine =
    os === "linux" && arch === "amd64"
      ? "x86_64"
      : os === "linux" && arch === "arm64"
        ? "aarch64"
        : os === "darwin" && arch === "arm64"
          ? "arm64"
          : undefined;
  if (!machine) fail(`unsupported release platform: ${os}/${arch}`);
  return `cocalc-cli-${releaseId}-${machine}-${os}${os === "linux" ? ".tar.gz" : ""}`;
}

function readHeader(path) {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(64);
    const length = readSync(fd, header, 0, header.length, 0);
    if (length < 24) fail(`release executable is too short: ${path}`);
    return header;
  } finally {
    closeSync(fd);
  }
}

function verifyBinaryHeader({ binary, os, arch }) {
  const header = readHeader(binary);
  if (os === "linux") {
    if (!header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
      fail(`Linux release is not an ELF executable: ${binary}`);
    }
    if (header[4] !== 2 || header[5] !== 1) {
      fail("Linux release must be a little-endian 64-bit ELF executable");
    }
    const expectedMachine = arch === "amd64" ? 62 : arch === "arm64" ? 183 : 0;
    const machine = header.readUInt16LE(18);
    if (!expectedMachine || machine !== expectedMachine) {
      fail(
        `Linux release architecture mismatch: expected ${arch} (ELF machine ${expectedMachine}), got machine ${machine}`,
      );
    }
    return;
  }
  if (os === "darwin") {
    if (header.readUInt32LE(0) !== 0xfeedfacf) {
      fail(
        `macOS release is not a little-endian 64-bit Mach-O executable: ${binary}`,
      );
    }
    const cpuType = header.readUInt32LE(4);
    if (arch !== "arm64" || cpuType !== 0x0100000c) {
      fail(
        `macOS release architecture mismatch: expected arm64, got CPU type 0x${cpuType.toString(16)}`,
      );
    }
    return;
  }
  fail(`unsupported release OS: ${os}`);
}

function materializeArtifact({ file, os, workDir }) {
  if (os === "darwin") return file;
  const listing = run("tar", ["-tzf", file]).stdout.trim();
  if (listing !== "cocalc\nlib/libatomic.so.1") {
    fail(`unexpected Linux runtime bundle contents:\n${listing}`);
  }
  run("tar", ["-xzf", file, "-C", workDir]);
  const binary = join(workDir, "cocalc");
  const privateLib = join(workDir, "lib", "libatomic.so.1");
  if (!statSync(binary).isFile() || !statSync(privateLib).isFile()) {
    fail("Linux runtime bundle is missing cocalc or lib/libatomic.so.1");
  }
  return binary;
}

function verifyDeveloperId(binary) {
  run("codesign", ["--verify", "--strict", "--verbose=2", binary]);
  const details = run("codesign", ["-dv", "--verbose=4", binary]);
  const output = `${details.stdout}\n${details.stderr}`;
  for (const expected of [
    "Authority=Developer ID Application:",
    "TeamIdentifier=",
    "flags=0x10000(runtime)",
    "Timestamp=",
  ]) {
    if (!output.includes(expected)) {
      fail(`macOS release signature is missing ${expected}`);
    }
  }
  if (output.includes("TeamIdentifier=not set")) {
    fail("macOS release signature does not contain an Apple team identifier");
  }
}

function verifyNativeExecution({ binary, os, arch, releaseId }) {
  const nativeArch = process.arch === "x64" ? "amd64" : process.arch;
  if (process.platform !== os || nativeArch !== arch) {
    fail(
      `native execution requested for ${os}/${arch} on ${process.platform}/${nativeArch}`,
    );
  }
  chmodSync(binary, 0o755);
  const env = {
    ...process.env,
    COCALC_CLI_ARTIFACT_ID: releaseId,
    COCALC_CLI_VERSION: releaseId,
  };
  if (os === "linux") {
    const privateLibDir = join(dirname(binary), "lib");
    env.COCALC_CLI_PRIVATE_LIB_DIR = privateLibDir;
    env.LD_LIBRARY_PATH = [privateLibDir, env.LD_LIBRARY_PATH]
      .filter(Boolean)
      .join(":");
  }
  const result = run(binary, ["--version"], { env });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (!output.includes(releaseId)) {
    fail(`cocalc --version did not include release id ${releaseId}: ${output}`);
  }
  return output;
}

const args = parseArgs(process.argv.slice(2));
const file = resolve(requiredString(args, "file"));
const os = requiredString(args, "os");
const arch = requiredString(args, "arch");
const releaseId = requiredString(args, "release-id");
const expected = expectedFilename({ os, arch, releaseId });
if (basename(file) !== expected) {
  fail(
    `release filename mismatch: expected ${expected}, got ${basename(file)}`,
  );
}

const workDir = mkdtempSync(join(tmpdir(), "cocalc-cli-release-verify-"));
try {
  const binary = materializeArtifact({ file, os, workDir });
  verifyBinaryHeader({ binary, os, arch });
  if (args["require-developer-id"]) {
    if (os !== "darwin") fail("--require-developer-id is only valid for macOS");
    verifyDeveloperId(binary);
  }
  const version = args.execute
    ? verifyNativeExecution({ binary, os, arch, releaseId })
    : undefined;
  process.stdout.write(
    `${JSON.stringify({ ok: true, file, os, arch, release_id: releaseId, version })}\n`,
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
