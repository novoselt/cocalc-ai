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
}

const caughtErrorScopes = new WeakMap<object, string>();

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

export function markCaughtReactError(error: unknown, scope: string): void {
  if (isWeakMapKey(error)) {
    caughtErrorScopes.set(error, scope);
  }
}

function dispatchReactError(
  kind: ReactErrorKind,
  error: unknown,
  errorInfo: Pick<ErrorInfo, "componentStack">,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ReactErrorEventDetail>(COCALC_REACT_ERROR_EVENT, {
      detail: {
        kind,
        error,
        componentStack: errorInfo.componentStack,
        boundaryScope: isWeakMapKey(error)
          ? caughtErrorScopes.get(error)
          : undefined,
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
