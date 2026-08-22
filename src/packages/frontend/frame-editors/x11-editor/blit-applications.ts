/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { IconName } from "@cocalc/frontend/components";

export type BlitApplicationInstall =
  | {
      kind: "apt";
      packages: readonly string[];
    }
  | {
      kind: "script";
      command: string;
      summary: string;
    };

export interface BlitApplication {
  id: string;
  label: string;
  description: string;
  icon: IconName;
  executable?: string;
  command: readonly string[];
  install?: BlitApplicationInstall;
}

const UBUNTU_ID = "$" + "{ID:-}";
const UBUNTU_VERSION_CODENAME = "$" + "{VERSION_CODENAME:-}";

export const INSTALL_CHROMIUM_APPLICATION_COMMAND = String.raw`set -euo pipefail
key=5301FA4FD93244FBC6F6149982BB6851C64F6880

. /etc/os-release
if [ "${UBUNTU_ID}" != ubuntu ] || [ -z "${UBUNTU_VERSION_CODENAME}" ]; then
  echo "The automatic Chromium installer currently supports Ubuntu projects only." >&2
  exit 1
fi

sudo -n true
sudo -n apt-get update
sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates dirmngr gnupg

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -m 700 "$tmp/gnupg"
gpg --batch --homedir "$tmp/gnupg" \
  --keyserver hkps://keyserver.ubuntu.com --recv-keys "$key"
gpg --batch --homedir "$tmp/gnupg" --export "$key" |
  sudo -n tee /usr/share/keyrings/xtradeb-apps.gpg >/dev/null
sudo -n chmod 0644 /usr/share/keyrings/xtradeb-apps.gpg

sudo -n tee /etc/apt/sources.list.d/xtradeb-apps.sources >/dev/null <<EOF
Types: deb
URIs: https://ppa.launchpadcontent.net/xtradeb/apps/ubuntu/
Suites: ${UBUNTU_VERSION_CODENAME}
Components: main
Signed-By: /usr/share/keyrings/xtradeb-apps.gpg
EOF

sudo -n tee /etc/apt/preferences.d/chromium-real-deb >/dev/null <<'EOF'
Package: chromium-browser
Pin: version 2:1snap*
Pin-Priority: -1

Package: chromium chromium-common chromium-driver chromium-headless-shell chromium-l10n chromium-sandbox chromium-shell
Pin: release o=LP-PPA-xtradeb-apps
Pin-Priority: 700
EOF

sudo -n apt-get update
sudo -n apt-get purge -y chromium-browser || true
sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y \
  chromium chromium-driver chromium-sandbox

sudo -n tee /usr/local/bin/chromium-browser >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec /usr/bin/chromium "$@"
EOF
sudo -n chmod 0755 /usr/local/bin/chromium-browser
sudo -n apt-get clean
sudo -n rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb`;

export const BLIT_APPLICATIONS = [
  {
    id: "terminal",
    label: "Terminal",
    description: "Open another Blit terminal.",
    icon: "terminal",
    command: [],
  },
  {
    id: "chromium",
    label: "Chromium",
    description: "The open-source Chromium web browser.",
    icon: "compass",
    executable: "chromium",
    command: [
      "chromium",
      "--ozone-platform=wayland",
      "--no-sandbox",
      "--disable-gpu",
    ],
    install: {
      kind: "script",
      command: INSTALL_CHROMIUM_APPLICATION_COMMAND,
      summary:
        "This adds the signed XtraDeb Ubuntu repository and installs its real Chromium Debian package, ChromiumDriver, and Chromium sandbox.",
    },
  },
  {
    id: "xclock",
    label: "XClock",
    description: "A small analog clock and a useful X11 compatibility test.",
    icon: "clock",
    executable: "xclock",
    command: ["xclock"],
    install: { kind: "apt", packages: ["x11-apps"] },
  },
  {
    id: "emacs",
    label: "Emacs",
    description: "The extensible GNU text editor with its GTK interface.",
    icon: "emacs",
    executable: "emacs",
    command: ["emacs"],
    install: { kind: "apt", packages: ["emacs-gtk"] },
  },
  {
    id: "gimp",
    label: "GIMP",
    description: "Image editing and retouching.",
    icon: "brush",
    executable: "gimp",
    command: ["gimp"],
    install: { kind: "apt", packages: ["gimp"] },
  },
  {
    id: "inkscape",
    label: "Inkscape",
    description: "Vector drawing and illustration.",
    icon: "inkscape",
    executable: "inkscape",
    command: ["inkscape"],
    install: { kind: "apt", packages: ["inkscape"] },
  },
  {
    id: "gnumeric",
    label: "Gnumeric",
    description: "A lightweight spreadsheet application.",
    icon: "table",
    executable: "gnumeric",
    command: ["gnumeric"],
    install: { kind: "apt", packages: ["gnumeric"] },
  },
  {
    id: "libreoffice-calc",
    label: "LibreOffice Calc",
    description: "A full-featured spreadsheet application.",
    icon: "libreoffice",
    executable: "libreoffice",
    command: ["libreoffice", "--calc"],
    install: { kind: "apt", packages: ["libreoffice-calc"] },
  },
  {
    id: "gvim",
    label: "GVim",
    description: "Vim with its GTK graphical interface.",
    icon: "vim",
    executable: "gvim",
    command: ["gvim"],
    install: { kind: "apt", packages: ["vim-gtk3"] },
  },
  {
    id: "krita",
    label: "Krita",
    description: "Digital painting and illustration.",
    icon: "brush",
    executable: "krita",
    command: ["krita"],
    install: { kind: "apt", packages: ["krita"] },
  },
  {
    id: "texstudio",
    label: "TeXstudio",
    description: "An integrated graphical LaTeX editor.",
    icon: "tex-file",
    executable: "texstudio",
    command: ["texstudio"],
    install: { kind: "apt", packages: ["texstudio"] },
  },
] as const satisfies readonly BlitApplication[];

export const CHECK_BLIT_APPLICATION_COMMAND = String.raw`set -euo pipefail
if command -v -- "$1" >/dev/null 2>&1; then
  printf 'cocalc-blit-app:installed\n'
else
  printf 'cocalc-blit-app:missing\n'
fi`;

export const INSTALL_BLIT_APPLICATION_COMMAND = String.raw`set -euo pipefail
sudo -n true
sudo -n apt-get update
sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
sudo -n apt-get clean
sudo -n rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb`;

const BASH_ARGUMENTS_FROM_SECOND = "$" + "{@:2}";

export const LAUNCH_BLIT_APPLICATION_COMMAND = String.raw`set -euo pipefail
exec blit \
  --on "socket:$HOME/.local/state/cocalc/blit/runtime/server.sock" \
  terminal start --tag "$1" -- "${BASH_ARGUMENTS_FROM_SECOND}"`;

export type BlitApplicationAvailability = "installed" | "missing";

export function parseBlitApplicationAvailability(
  output: string,
): BlitApplicationAvailability {
  if (output.includes("cocalc-blit-app:installed")) {
    return "installed";
  }
  if (output.includes("cocalc-blit-app:missing")) {
    return "missing";
  }
  throw new Error("Unable to determine whether the application is installed.");
}
