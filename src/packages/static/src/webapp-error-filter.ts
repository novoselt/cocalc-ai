const IGNORED_BROWSER_ERROR_MESSAGES = new Set([
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
]);

export function isIgnorableBrowserError(message: unknown): boolean {
  return (
    typeof message === "string" &&
    IGNORED_BROWSER_ERROR_MESSAGES.has(message.trim())
  );
}

function rejectionMessage(reason: unknown): string {
  if (typeof reason === "string") {
    return reason.trim().toLowerCase();
  }
  if (reason != null && typeof reason === "object") {
    const message = (reason as { message?: unknown }).message;
    if (typeof message === "string") {
      return message.trim().toLowerCase();
    }
  }
  return "";
}

export function isIgnorableUnhandledRejection(reason: unknown): boolean {
  const message = rejectionMessage(reason);
  if (!message) {
    return false;
  }
  const rootfsUnavailable =
    message.includes("rootfs is not mounted") &&
    message.includes("start the project and try again");
  const routingUnavailable =
    message.includes("unable to route") &&
    message.includes("'projectactions.fs'") &&
    message.includes("project-host") &&
    message.includes("host routing info unavailable");
  const conatInfoBootstrapTimeout =
    message.includes("once: timeout") &&
    (message.includes('waiting for "info"') ||
      message.includes("waiting for 'info'") ||
      message.includes("waiting for info"));
  return rootfsUnavailable || routingUnavailable || conatInfoBootstrapTimeout;
}

export function isOpaqueCrossOriginScriptError({
  message,
  error,
  filename,
  lineNumber,
}: {
  message: unknown;
  error: unknown;
  filename: unknown;
  lineNumber: unknown;
}): boolean {
  return (
    message === "Script error." &&
    error == null &&
    !filename &&
    (lineNumber == null || lineNumber === 0)
  );
}
