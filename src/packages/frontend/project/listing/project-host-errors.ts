/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export function getErrorMessage(error: unknown): string {
  return `${(error as any)?.message ?? (error as any)?.error ?? error ?? ""}`
    .trim()
    .toLowerCase();
}

export function isConatInfoBootstrapTimeout(error: unknown): boolean {
  const message = getErrorMessage(error);
  if (!message.includes("once: timeout")) {
    return false;
  }
  return (
    message.includes('waiting for "info"') ||
    message.includes("waiting for 'info'") ||
    message.includes("waiting for info")
  );
}

export function isProjectRootfsUnavailable(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("rootfs is not mounted") &&
    message.includes("start the project and try again")
  );
}

export function isProjectHostRoutingUnavailable(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("unable to route") &&
    message.includes("project-host") &&
    message.includes("host routing info unavailable")
  );
}

export function isProjectHostTemporarilyUnavailable(error: unknown): boolean {
  return (
    isConatInfoBootstrapTimeout(error) ||
    isProjectRootfsUnavailable(error) ||
    isProjectHostRoutingUnavailable(error)
  );
}
