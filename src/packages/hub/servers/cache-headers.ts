/*
 *  This file is part of CoCalc: Copyright (C) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export function expiresAfterSeconds(
  seconds: number,
  nowMs = Date.now(),
): string {
  return new Date(nowMs + seconds * 1000).toUTCString();
}
