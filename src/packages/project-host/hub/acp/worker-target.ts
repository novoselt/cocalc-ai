/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import fs from "node:fs";
import path from "node:path";
import { data } from "@cocalc/backend/data";

const TARGET_SCHEMA = "cocalc-project-host-acp-worker-target-v1";

export type ProjectHostAcpWorkerTarget = {
  schema: typeof TARGET_SCHEMA;
  artifact_version: string;
  build_id: string;
  bundle_path: string;
  entry_point: string;
  updated_at: string;
};

export function projectHostAcpWorkerTargetPath(): string {
  return (
    `${process.env.COCALC_PROJECT_HOST_ACP_WORKER_TARGET_FILE ?? ""}`.trim() ||
    path.join(data, "managed-components", "acp-worker-target.json")
  );
}

function projectHostArtifactLayout(artifactVersion: string): {
  root: string;
  bundlePath: string;
} {
  const configured =
    `${process.env.COCALC_PROJECT_HOST_BUNDLE_ROOT ?? ""}`.trim();
  if (configured) {
    return {
      root: configured,
      bundlePath: path.join(configured, artifactVersion),
    };
  }
  const current = `${process.env.COCALC_PROJECT_HOST_CURRENT ?? ""}`.trim();
  if (current) {
    const root = path.join(path.dirname(current), "bundles");
    return { root, bundlePath: path.join(root, artifactVersion) };
  }
  const root = path.join("/opt/cocalc/project-host", "versions");
  return { root, bundlePath: path.join(root, artifactVersion) };
}

function validateVersion(version: string): string {
  const value = `${version ?? ""}`.trim();
  if (
    !value ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error(
      `invalid ACP worker artifact version: ${JSON.stringify(version)}`,
    );
  }
  return value;
}

function targetForArtifactVersion(
  artifactVersion: string,
): ProjectHostAcpWorkerTarget {
  const version = validateVersion(artifactVersion);
  const { root, bundlePath } = projectHostArtifactLayout(version);
  const entryPoint = path.join(bundlePath, "main", "index.js");
  const identityPath = path.join(bundlePath, "build-identity.json");
  const realRoot = fs.realpathSync(root);
  const realBundlePath = fs.realpathSync(bundlePath);
  if (
    realBundlePath !== realRoot &&
    !realBundlePath.startsWith(`${realRoot}${path.sep}`)
  ) {
    throw new Error(
      `ACP worker bundle escapes project-host root: ${bundlePath}`,
    );
  }
  if (!fs.statSync(entryPoint).isFile()) {
    throw new Error(`ACP worker entry point is not a file: ${entryPoint}`);
  }
  const identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
  const buildId = `${identity?.build_id ?? ""}`.trim();
  if (!buildId) {
    throw new Error(`ACP worker bundle has no build_id: ${identityPath}`);
  }
  return {
    schema: TARGET_SCHEMA,
    artifact_version: version,
    build_id: buildId,
    bundle_path: realBundlePath,
    entry_point: fs.realpathSync(entryPoint),
    updated_at: new Date().toISOString(),
  };
}

function validateStoredTarget(value: unknown): ProjectHostAcpWorkerTarget {
  const target = value as Partial<ProjectHostAcpWorkerTarget>;
  if (target?.schema !== TARGET_SCHEMA) {
    throw new Error("unsupported ACP worker target schema");
  }
  const expected = targetForArtifactVersion(`${target.artifact_version ?? ""}`);
  if (
    target.build_id !== expected.build_id ||
    target.bundle_path !== expected.bundle_path ||
    target.entry_point !== expected.entry_point
  ) {
    throw new Error("ACP worker target does not match the installed artifact");
  }
  return {
    ...expected,
    updated_at: `${target.updated_at ?? ""}`.trim() || expected.updated_at,
  };
}

export function readProjectHostAcpWorkerTarget():
  | ProjectHostAcpWorkerTarget
  | undefined {
  try {
    const raw = fs.readFileSync(projectHostAcpWorkerTargetPath(), "utf8");
    return validateStoredTarget(JSON.parse(raw));
  } catch {
    return;
  }
}

export function writeProjectHostAcpWorkerTarget(
  artifactVersion: string,
): ProjectHostAcpWorkerTarget {
  const target = targetForArtifactVersion(artifactVersion);
  const filename = projectHostAcpWorkerTargetPath();
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${filename}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  try {
    const handle = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(handle, `${JSON.stringify(target, null, 2)}\n`);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporary, filename);
    const directoryHandle = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(directoryHandle);
    } finally {
      fs.closeSync(directoryHandle);
    }
  } catch (err) {
    fs.rmSync(temporary, { force: true });
    throw err;
  }
  return target;
}
