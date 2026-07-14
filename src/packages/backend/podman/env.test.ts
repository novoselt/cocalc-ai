/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { configuredContainerRuntimeCurrent, podmanEnv } from "./env";

describe("podmanEnv", () => {
  it("selects an executable CoCalc container runtime without replacing state paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cocalc-podman-env-"));
    try {
      const current = path.join(root, "current");
      const bin = path.join(current, "bin");
      const conf = path.join(current, "etc", "containers", "containers.conf");
      const runtimeDir = path.join(root, "run");
      fs.mkdirSync(bin, { recursive: true });
      fs.mkdirSync(path.dirname(conf), { recursive: true });
      fs.mkdirSync(runtimeDir);
      fs.writeFileSync(path.join(bin, "podman"), "#!/bin/sh\nexit 0\n", {
        mode: 0o755,
      });
      fs.writeFileSync(conf, "[engine]\n");
      const base = {
        PATH: "/usr/bin",
        COCALC_CONTAINER_RUNTIME_CURRENT: current,
        COCALC_PODMAN_RUNTIME_DIR: runtimeDir,
        CONTAINERS_STORAGE_CONF: "/existing/storage.conf",
      };

      expect(configuredContainerRuntimeCurrent(base)).toBe(current);
      expect(podmanEnv(base)).toMatchObject({
        PATH: `${bin}:/usr/bin`,
        COCALC_PODMAN_BIN: path.join(bin, "podman"),
        CONTAINERS_CONF_OVERRIDE: conf,
        CONTAINERS_STORAGE_CONF: "/existing/storage.conf",
        CONTAINERS_CGROUP_MANAGER: "cgroupfs",
        XDG_RUNTIME_DIR: runtimeDir,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
