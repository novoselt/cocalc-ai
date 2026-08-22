/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { expiresAfterSeconds } from "./cache-headers";

const APPLICATION_SHELL_MAX_AGE_SECONDS = 10;

interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}

// Application shells are mutable and may carry per-client worker affinity.
// Browsers may briefly reuse them, but shared caches must not.
export function setApplicationShellCacheHeaders(res: HeaderResponse): void {
  res.setHeader(
    "Cache-Control",
    `private, max-age=${APPLICATION_SHELL_MAX_AGE_SECONDS}, must-revalidate`,
  );
  res.setHeader(
    "Expires",
    expiresAfterSeconds(APPLICATION_SHELL_MAX_AGE_SECONDS),
  );
}
