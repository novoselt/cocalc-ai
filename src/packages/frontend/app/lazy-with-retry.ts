/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 750;

export async function loadWithRetry<T>(
  loader: () => Promise<T>,
  {
    attempts = DEFAULT_ATTEMPTS,
    name,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  }: {
    attempts?: number;
    name: string;
    retryDelayMs?: number;
  },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await loader();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  const causeMessage =
    lastError != null && typeof lastError === "object" && "message" in lastError
      ? `${lastError.message ?? ""}`.trim()
      : `${lastError ?? ""}`.trim();
  const error = new Error(
    `Failed to load ${name} after ${attempts} attempts${
      causeMessage ? `: ${causeMessage}` : ""
    }`,
  );
  (error as Error & { cause?: unknown }).cause = lastError;
  throw error;
}

export function lazyWithRetry<Props>(
  loader: () => Promise<{ default: ComponentType<Props> }>,
  name: string,
): LazyExoticComponent<ComponentType<Props>> {
  return lazy(async () => await loadWithRetry(loader, { name }));
}
