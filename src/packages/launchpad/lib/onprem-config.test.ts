import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  applyLaunchpadDefaults,
  resolveLaunchpadHost,
  scrubLaunchpadInheritedRuntimeEnv,
} = require("./onprem-config") as {
  applyLaunchpadDefaults: () => Promise<void>;
  resolveLaunchpadHost: () => string;
  scrubLaunchpadInheritedRuntimeEnv: () => void;
};

describe("launchpad onprem config", () => {
  const names = [
    "COCALC_BASE_PORT",
    "COCALC_DATA_DIR",
    "COCALC_HTTP_PORT",
    "COCALC_PGLITE_DATA_DIR",
    "COCALC_PRODUCT",
    "COCALC_PUBLIC_HOST",
    "COCALC_PROJECT_PATH",
    "COCALC_PROJECT_RUNTIME",
    "COCALC_SSHD_PORT",
    "COCALC_WORKSPACE_RUNTIME_LOGS",
    "COCALC_WORKSPACE_RUNTIME_STATE",
    "DATA",
    "CONAT_SERVER",
    "PORT",
  ] as const;
  const original = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );

  afterEach(() => {
    for (const name of names) {
      const value = original[name];
      if (value == null) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("normalizes explicit public host URLs to hostnames", () => {
    process.env.COCALC_PUBLIC_HOST = "https://launchpad.example.com:9443";
    expect(resolveLaunchpadHost()).toBe("launchpad.example.com");
  });

  it("scrubs inherited project-host Conat server env", () => {
    process.env.CONAT_SERVER = "http://10.180.0.1:9102/";
    scrubLaunchpadInheritedRuntimeEnv();
    expect(process.env.CONAT_SERVER).toBeUndefined();
  });

  it("keeps workspace state, projects, and logs outside the source checkout", async () => {
    const root = await mkdtemp(join(tmpdir(), "cocalc-launchpad-workspace-"));
    try {
      for (const name of names) {
        delete process.env[name];
      }
      process.env.DATA = root;
      process.env.COCALC_PROJECT_RUNTIME = "workspace";
      await applyLaunchpadDefaults();
      expect(process.env.COCALC_PROJECT_PATH).toBe(join(root, "projects"));
      expect(process.env.COCALC_WORKSPACE_RUNTIME_STATE).toBe(
        join(root, "runtime"),
      );
      expect(process.env.COCALC_WORKSPACE_RUNTIME_LOGS).toBe(
        join(root, "logs", "projects"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
