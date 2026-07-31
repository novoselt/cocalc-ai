/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const DEFAULT_DEADLINE_MS = 2 * 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_MS = 2_000;
const EXPECTED_MARKER = "CoCalc Exam Scratchpad";

interface ProbeOptions {
  deadlineMs?: number;
  requestTimeoutMs?: number;
  retryMs?: number;
  fetchImpl?: typeof fetch;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifyExamPublicRoute(
  hostname: string,
  {
    deadlineMs = DEFAULT_DEADLINE_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    retryMs = DEFAULT_RETRY_MS,
    fetchImpl = fetch,
  }: ProbeOptions = {},
): Promise<void> {
  const normalized = `${hostname ?? ""}`.trim().toLowerCase();
  if (!normalized) throw new Error("exam hostname is required");
  const url = `https://${normalized}/`;
  const deadline = Date.now() + deadlineMs;
  let lastError = "probe did not run";
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, {
        redirect: "error",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const body = await response.text();
      if (response.status === 200 && body.includes(EXPECTED_MARKER)) {
        return;
      }
      lastError = `unexpected response ${response.status}`;
    } catch (err) {
      lastError = `${err}`;
    }
    await delay(retryMs);
  }
  throw new Error(
    `exam public route readiness failed for ${url}: ${lastError}`,
  );
}
