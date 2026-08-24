import { readdirSync } from "node:fs";
import { join } from "node:path";

export function projectHostBootstrapDirCandidates(): string[] {
  const candidates = new Set<string>();
  const explicitDir =
    `${process.env.COCALC_PROJECT_HOST_BOOTSTRAP_DIR ?? ""}`.trim();
  if (explicitDir) {
    candidates.add(explicitDir);
  }
  // The root-owned bootstrap state contains credentials. Bootstrap publishes
  // an allowlisted lifecycle view here for the unprivileged host process.
  candidates.add("/var/lib/cocalc/bootstrap-lifecycle");
  const home = `${process.env.HOME ?? ""}`.trim();
  if (home) {
    candidates.add(join(home, "cocalc-host", "bootstrap"));
  }
  candidates.add("/mnt/cocalc/data/.host-bootstrap/bootstrap");
  candidates.add("/home/ubuntu/cocalc-host/bootstrap");
  try {
    for (const user of readdirSync("/home")) {
      candidates.add(`/home/${user}/cocalc-host/bootstrap`);
    }
  } catch {
    // ignore missing /home etc.
  }
  return [...candidates];
}
