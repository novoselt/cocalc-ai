import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const packageRoot = process.cwd();
const verifier = join(packageRoot, "sea", "verify-release-artifact.mjs");
const releaseId = "20260811T000000Z-deadbeef-verifier-test";

function elfHeader(machine: number): Buffer {
  const header = Buffer.alloc(64);
  header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  header.writeUInt16LE(machine, 18);
  return header;
}

function linuxBundle({
  dir,
  machine,
  name,
}: {
  dir: string;
  machine: number;
  name: string;
}): string {
  const root = join(dir, "runtime");
  mkdirSync(join(root, "lib"), { recursive: true });
  writeFileSync(join(root, "cocalc"), elfHeader(machine));
  writeFileSync(join(root, "lib", "libatomic.so.1"), "fixture\n");
  const artifact = join(dir, name);
  const result = spawnSync(
    "tar",
    ["-czf", artifact, "-C", root, "cocalc", "lib/libatomic.so.1"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return artifact;
}

function verify(args: string[]) {
  return spawnSync(process.execPath, [verifier, ...args], {
    encoding: "utf8",
  });
}

test("release verifier accepts an amd64 Linux runtime bundle", () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-release-verifier-amd64-"));
  const artifact = linuxBundle({
    dir,
    machine: 62,
    name: `cocalc-cli-${releaseId}-x86_64-linux.tar.gz`,
  });
  const result = verify([
    "--file",
    artifact,
    "--os",
    "linux",
    "--arch",
    "amd64",
    "--release-id",
    releaseId,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test("release verifier rejects a mislabeled Linux architecture", () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-release-verifier-arm64-"));
  const artifact = linuxBundle({
    dir,
    machine: 62,
    name: `cocalc-cli-${releaseId}-aarch64-linux.tar.gz`,
  });
  const result = verify([
    "--file",
    artifact,
    "--os",
    "linux",
    "--arch",
    "arm64",
    "--release-id",
    releaseId,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /architecture mismatch/);
});

test("release verifier accepts an arm64 Mach-O header", () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-release-verifier-macos-"));
  const artifact = join(dir, `cocalc-cli-${releaseId}-arm64-darwin`);
  const header = Buffer.alloc(64);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  writeFileSync(artifact, header);
  const result = verify([
    "--file",
    artifact,
    "--os",
    "darwin",
    "--arch",
    "arm64",
    "--release-id",
    releaseId,
  ]);
  assert.equal(result.status, 0, result.stderr);
});

test("release verifier accepts an amd64 Windows PE32+ header", () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-release-verifier-windows-"));
  const artifact = join(dir, `cocalc-cli-${releaseId}-x86_64-windows.exe`);
  const header = Buffer.alloc(256);
  header.writeUInt16LE(0x5a4d, 0);
  header.writeUInt32LE(128, 0x3c);
  header.writeUInt32LE(0x00004550, 128);
  header.writeUInt16LE(0x8664, 132);
  header.writeUInt16LE(0x20b, 152);
  writeFileSync(artifact, header);
  const result = verify([
    "--file",
    artifact,
    "--os",
    "windows",
    "--arch",
    "amd64",
    "--release-id",
    releaseId,
  ]);
  assert.equal(result.status, 0, result.stderr);
});
