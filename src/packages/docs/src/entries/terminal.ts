/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { DocsEntry } from "../types";
import { docsIcon, projectActionParameters } from "../helpers";
import { SSH_ACCESS_BODY, USE_TERMINAL_BODY } from "../content";

export const TERMINAL_ENTRIES: DocsEntry[] = [
  {
    audiences: ["researchers", "students", "teams"],
    body: SSH_ACCESS_BODY.trim(),
    category: "Terminal",
    id: "terminal.ssh-access",
    image: docsIcon(
      "/public/docs/terminal-56905fa2.webp",
      "Terminal connected to a persistent CoCalc project",
    ),
    lastReviewed: "2026-07-24",
    slug: "terminal/ssh-access",
    status: "ready",
    summary:
      "Connect to cocalc.ai projects from a computer or another CoCalc project using SSH.",
    title: "SSH access to projects",
  },
  {
    actions: [
      {
        description: "Open a terminal in the active project.",
        executable: true,
        id: "terminal.open",
        label: "Open terminal",
        parameters: projectActionParameters(),
      },
    ],
    audiences: ["agents", "researchers", "students", "teams"],
    body: USE_TERMINAL_BODY.trim(),
    category: "Terminal",
    id: "terminal.use-terminal",
    image: docsIcon(
      "/public/docs/terminal-56905fa2.webp",
      "Hand-drawn terminal opening project files",
    ),
    lastReviewed: "2026-05-25",
    slug: "terminal/use-terminal",
    status: "ready",
    summary:
      "Use persistent collaborative Linux shell sessions inside CoCalc projects.",
    title: "Use terminals",
  },
];
