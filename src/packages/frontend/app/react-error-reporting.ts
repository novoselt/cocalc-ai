/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ErrorInfo } from "react";

declare var DEBUG: boolean;

export const COCALC_REACT_ERROR_EVENT = "cocalc:react-error";
export const COCALC_REACT_ROOT_READY_EVENT = "cocalc:react-root-ready";

export type ReactErrorKind = "caught" | "recoverable" | "uncaught";

export interface ReactErrorEventDetail {
  kind: ReactErrorKind;
  error: unknown;
  componentStack?: string | null;
  boundaryScope?: string;
  boundaryAction?: "auto-retry" | "fallback";
  boundaryRetryCount?: number;
}

interface CaughtErrorContext {
  scope: string;
  action?: ReactErrorEventDetail["boundaryAction"];
  retryCount?: number;
}

const caughtErrorContexts = new WeakMap<object, CaughtErrorContext>();

function logDevelopmentError(
  kind: ReactErrorKind,
  error: unknown,
  errorInfo: Pick<ErrorInfo, "componentStack">,
): void {
  if (typeof DEBUG === "undefined" || !DEBUG) return;
  const args = [`React ${kind} error`, error, errorInfo.componentStack];
  if (kind === "recoverable") {
    console.warn(...args);
  } else {
    console.error(...args);
  }
}

function isWeakMapKey(value: unknown): value is object {
  return (
    (typeof value === "object" && value != null) || typeof value === "function"
  );
}

export function markCaughtReactError(
  error: unknown,
  scope: string,
  context: Omit<CaughtErrorContext, "scope"> = {},
): void {
  if (isWeakMapKey(error)) {
    caughtErrorContexts.set(error, { scope, ...context });
  }
}

function dispatchReactError(
  kind: ReactErrorKind,
  error: unknown,
  errorInfo: Pick<ErrorInfo, "componentStack">,
): void {
  if (typeof window === "undefined") return;
  const context = isWeakMapKey(error)
    ? caughtErrorContexts.get(error)
    : undefined;
  window.dispatchEvent(
    new CustomEvent<ReactErrorEventDetail>(COCALC_REACT_ERROR_EVENT, {
      detail: {
        kind,
        error,
        componentStack: errorInfo.componentStack,
        boundaryScope: context?.scope,
        ...(context?.action == null ? {} : { boundaryAction: context.action }),
        ...(context?.retryCount == null
          ? {}
          : { boundaryRetryCount: context.retryCount }),
      },
    }),
  );
}

export const reactRootErrorHandlers = {
  onCaughtError(error: unknown, errorInfo: ErrorInfo): void {
    logDevelopmentError("caught", error, errorInfo);
    // React invokes the root callback before componentDidCatch in some render
    // paths. Defer dispatch so a scoped boundary can annotate the error first.
    queueMicrotask(() => dispatchReactError("caught", error, errorInfo));
  },

  onRecoverableError(error: unknown, errorInfo: ErrorInfo): void {
    logDevelopmentError("recoverable", error, errorInfo);
    dispatchReactError("recoverable", error, errorInfo);
  },

  onUncaughtError(error: unknown, errorInfo: ErrorInfo): void {
    logDevelopmentError("uncaught", error, errorInfo);
    dispatchReactError("uncaught", error, errorInfo);
  },
} as const;

export function enableManagedReactErrorHandling(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COCALC_REACT_ROOT_READY_EVENT));
}
