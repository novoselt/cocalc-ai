/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { ReactNode } from "react";

export type UltraliteIconName =
  | "apps"
  | "back"
  | "chat"
  | "chevron"
  | "code"
  | "external"
  | "file"
  | "folder"
  | "projects"
  | "refresh"
  | "server"
  | "terminal";

const PATHS: Record<UltraliteIconName, ReactNode> = {
  apps: (
    <>
      <rect height="6" rx="1" width="6" x="3" y="3" />
      <rect height="6" rx="1" width="6" x="15" y="3" />
      <rect height="6" rx="1" width="6" x="3" y="15" />
      <rect height="6" rx="1" width="6" x="15" y="15" />
    </>
  ),
  back: <path d="m15 18-6-6 6-6" />,
  chat: (
    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  code: (
    <>
      <path d="m8 9-4 3 4 3" />
      <path d="m16 9 4 3-4 3" />
      <path d="m14 5-4 14" />
    </>
  ),
  external: (
    <>
      <path d="M15 3h6v6" />
      <path d="m10 14 11-11" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
  file: (
    <>
      <path d="M6 2h8l4 4v16H6Z" />
      <path d="M14 2v5h5" />
    </>
  ),
  folder: <path d="M3 6h7l2 2h9v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  projects: (
    <>
      <path d="M4 4h16v16H4Z" />
      <path d="M4 9h16M9 9v11" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 6v5h-5" />
      <path d="M19 11a8 8 0 1 0 1 5" />
    </>
  ),
  server: (
    <>
      <rect height="7" rx="1" width="18" x="3" y="3" />
      <rect height="7" rx="1" width="18" x="3" y="14" />
      <path d="M7 7h.01M7 18h.01" />
    </>
  ),
  terminal: (
    <>
      <rect height="16" rx="2" width="20" x="2" y="4" />
      <path d="m6 9 3 3-3 3M12 15h5" />
    </>
  ),
};

export function UltraliteIcon({
  name,
  size = 18,
}: {
  name: UltraliteIconName;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className="ul-icon"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      {PATHS[name]}
    </svg>
  );
}
