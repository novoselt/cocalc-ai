/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { AppSpec } from "@cocalc/conat/project/api/apps";

export const BLIT_APP_ID = "cocalc-blit-x11";

export const GRAPHICAL_APPS_PACKAGES = [
  "adwaita-icon-theme",
  "dbus-daemon",
  "libegl1",
  "libxcb-cursor0",
  "mesa-vulkan-drivers",
  "shared-mime-info",
  "xwayland",
] as const;

const GRAPHICAL_APPS_PACKAGE_LIST = GRAPHICAL_APPS_PACKAGES.join(" ");
const DPKG_STATUS = "$" + "{Status}";

export const CHECK_BLIT_PREREQUISITES = String.raw`set -uo pipefail
status=0
for tool in apt-get dpkg-query sudo; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'missing-tool:%s\n' "$tool"
    status=20
  fi
done
for tool in blit cocalc-x11 xwayland-satellite; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'missing-tool:%s\n' "$tool"
    status=20
  fi
done
[ "$status" -ne 20 ] || exit "$status"

for package in ${GRAPHICAL_APPS_PACKAGE_LIST}; do
  if ! dpkg-query -W -f='${DPKG_STATUS}' "$package" 2>/dev/null |
       grep -q 'install ok installed'; then
    printf 'missing-package:%s\n' "$package"
    status=21
  fi
done
exit "$status"`;

export const INSTALL_GRAPHICAL_APPS_COMMAND = String.raw`set -euo pipefail
sudo -n true
sudo -n apt-get update
sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y \
  --no-install-recommends ${GRAPHICAL_APPS_PACKAGE_LIST}
sudo -n apt-get clean
sudo -n rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb`;

export interface BlitPrerequisites {
  missingPackages: string[];
  missingTools: string[];
}

export function parseBlitPrerequisites(output: string): BlitPrerequisites {
  const missingPackages: string[] = [];
  const missingTools: string[] = [];
  for (const line of output.split("\n")) {
    if (line.startsWith("missing-package:")) {
      missingPackages.push(line.slice("missing-package:".length));
    } else if (line.startsWith("missing-tool:")) {
      missingTools.push(line.slice("missing-tool:".length));
    }
  }
  return { missingPackages, missingTools };
}

export function createBlitAppSpec(projectId: string): AppSpec {
  return {
    version: 1,
    id: BLIT_APP_ID,
    title: "Graphical applications",
    kind: "service",
    command: {
      exec: "cocalc-x11",
      env: {
        // The authenticated project proxy is the security boundary. Blit also
        // requires a matching gateway passphrase, so use a project-specific,
        // collaborator-stable value rather than one global shared value.
        BLIT_PASSPHRASE: projectId,
      },
    },
    lifecycle: {
      mode: "managed",
    },
    network: {
      listen_host: "127.0.0.1",
      protocol: "http",
    },
    proxy: {
      base_path: `/apps/${BLIT_APP_ID}`,
      strip_prefix: true,
      websocket: true,
      // Blit resolves workers and sockets relative to the document URL, so
      // CoCalc must strip its route prefix before forwarding each subrequest.
      open_mode: "proxy",
      health_path: "/",
      readiness_timeout_s: 30,
    },
    wake: {
      enabled: true,
      keep_warm_s: 15 * 60,
      startup_timeout_s: 45,
    },
  };
}

export function addBlitPassphrase(url: string, projectId: string): string {
  return `${url.split("#", 1)[0]}#psk=${encodeURIComponent(projectId)}`;
}
