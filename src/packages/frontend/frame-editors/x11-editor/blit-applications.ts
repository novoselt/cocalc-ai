/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { IconName } from "@cocalc/frontend/components";

export interface BlitApplication {
  id: string;
  label: string;
  description: string;
  icon: IconName;
  executable?: string;
  command: readonly string[];
  install?: {
    kind: "apt";
    packages: readonly string[];
  };
}

export const BLIT_APPLICATIONS = [
  {
    id: "terminal",
    label: "Terminal",
    description: "Open another Blit terminal.",
    icon: "terminal",
    command: [],
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
