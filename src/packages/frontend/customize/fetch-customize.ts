/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export const CUSTOMIZE_REQUEST_TIMEOUT_MS = 15_000;

export async function fetchCustomize({
  url,
  timeout_ms = CUSTOMIZE_REQUEST_TIMEOUT_MS,
}: {
  url: string;
  timeout_ms?: number;
}): Promise<Record<string, any>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeout_ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `site configuration request failed (${response.status} ${response.statusText})`,
      );
    }
    const customize = await response.json();
    if (
      customize == null ||
      typeof customize !== "object" ||
      customize.configuration == null ||
      typeof customize.configuration !== "object"
    ) {
      throw new Error("site configuration response is invalid");
    }
    return customize;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error("site configuration request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
