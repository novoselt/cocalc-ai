/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { normalizeUserFacingError } from "@cocalc/frontend/components/user-facing-error";
import { sleep } from "@cocalc/util/async-utils";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

export function isTransientCourseConfigurationError(error: unknown): boolean {
  const code = `${(error as { code?: unknown })?.code ?? ""}`.trim();
  const message = `${
    (error as { message?: unknown })?.message ?? error ?? ""
  }`.toLowerCase();
  return (
    code === "408" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("code='408'") ||
    message.includes("code=408")
  );
}

export async function retryCourseConfigurationWrite<T>(
  operation: () => Promise<T>,
  {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    wait = sleep,
  }: {
    maxAttempts?: number;
    retryDelayMs?: number;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt >= maxAttempts ||
        !isTransientCourseConfigurationError(error)
      ) {
        throw error;
      }
      await wait(retryDelayMs * 2 ** (attempt - 1));
    }
  }
}

export function courseConfigurationErrorMessage(error: unknown): string {
  return `Error configuring student projects - ${normalizeUserFacingError(error).message}`;
}
