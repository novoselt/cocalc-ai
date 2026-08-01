import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  projectHostAcpWorkerTargetPath,
  readProjectHostAcpWorkerTarget,
  writeProjectHostAcpWorkerTarget,
} from "./hub/acp/worker-target";
import { resolveProjectHostAcpWorkerLaunch } from "./hub/acp/worker-manager";

describe("project-host ACP worker target", () => {
  let base: string;
  let bundleRoot: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "cocalc-acp-target-test-"));
    bundleRoot = path.join(base, "bundles");
    process.env.COCALC_PROJECT_HOST_BUNDLE_ROOT = bundleRoot;
    process.env.COCALC_PROJECT_HOST_ACP_WORKER_TARGET_FILE = path.join(
      base,
      "data",
      "acp-worker-target.json",
    );
  });

  afterEach(() => {
    delete process.env.COCALC_PROJECT_HOST_BUNDLE_ROOT;
    delete process.env.COCALC_PROJECT_HOST_ACP_WORKER_TARGET_FILE;
    fs.rmSync(base, { recursive: true, force: true });
  });

  function installBundle(version: string, buildId: string): string {
    const bundlePath = path.join(bundleRoot, version);
    const entryPoint = path.join(bundlePath, "main", "index.js");
    fs.mkdirSync(path.dirname(entryPoint), { recursive: true });
    fs.writeFileSync(entryPoint, "// test ACP entry point\n");
    fs.writeFileSync(
      path.join(bundlePath, "build-identity.json"),
      JSON.stringify({ build_id: buildId }),
    );
    return bundlePath;
  }

  it("persists and validates an installed component bundle", () => {
    const bundlePath = installBundle("artifact-v2", "build-v2");

    expect(writeProjectHostAcpWorkerTarget("artifact-v2")).toMatchObject({
      artifact_version: "artifact-v2",
      build_id: "build-v2",
      bundle_path: bundlePath,
      entry_point: path.join(bundlePath, "main", "index.js"),
    });
    expect(readProjectHostAcpWorkerTarget()).toMatchObject({
      artifact_version: "artifact-v2",
      build_id: "build-v2",
    });
    expect(projectHostAcpWorkerTargetPath()).toBe(
      process.env.COCALC_PROJECT_HOST_ACP_WORKER_TARGET_FILE,
    );
    expect(
      resolveProjectHostAcpWorkerLaunch({ command: process.execPath }),
    ).toEqual({
      command: process.execPath,
      args: [path.join(bundlePath, "main", "index.js")],
    });
  });

  it("rejects missing, malformed, and path-traversing targets", () => {
    expect(() => writeProjectHostAcpWorkerTarget("missing")).toThrow();
    expect(() => writeProjectHostAcpWorkerTarget("../escape")).toThrow(
      "invalid ACP worker artifact version",
    );

    installBundle("artifact-v2", "build-v2");
    writeProjectHostAcpWorkerTarget("artifact-v2");
    fs.writeFileSync(
      projectHostAcpWorkerTargetPath(),
      JSON.stringify({ schema: "bad", artifact_version: "artifact-v2" }),
    );
    expect(readProjectHostAcpWorkerTarget()).toBeUndefined();
  });

  it("detects replacement of a targeted immutable artifact", () => {
    const bundlePath = installBundle("artifact-v2", "build-v2");
    writeProjectHostAcpWorkerTarget("artifact-v2");
    fs.writeFileSync(
      path.join(bundlePath, "build-identity.json"),
      JSON.stringify({ build_id: "unexpected-build" }),
    );

    expect(readProjectHostAcpWorkerTarget()).toBeUndefined();
  });
});
