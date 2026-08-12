/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { conat } from "@cocalc/conat/client";
import { fsClient, fsSubject } from "@cocalc/conat/files/fs";
import { terminalClient } from "@cocalc/conat/project/terminal";
import { FALLBACK_PROJECT_UUID } from "@cocalc/util/misc";

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Windows runtime smoke test timed out after ${timeoutMs}ms`);
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
}

async function smokeHttp(port: number): Promise<void> {
  const rootUrl = `http://localhost:${port}/`;
  const redirect = await fetchWithTimeout(rootUrl, { redirect: "manual" });
  if (redirect.status !== 302) {
    throw new Error(
      `HTTP smoke expected a redirect, got status ${redirect.status}`,
    );
  }
  const location = redirect.headers.get("location");
  await redirect.body?.cancel();
  if (!location) {
    throw new Error("HTTP smoke redirect did not include a location");
  }

  const app = await fetchWithTimeout(new URL(location, rootUrl).href);
  if (!app.ok) {
    throw new Error(`HTTP app smoke failed with status ${app.status}`);
  }
  const html = await app.text();
  if (!html.toLowerCase().includes("cocalc")) {
    throw new Error("HTTP app response did not contain the CoCalc app");
  }
}

export async function runWindowsRuntimeSmoke(port: number): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("the Windows runtime smoke test requires Windows");
  }
  const client = conat();
  const project_id = FALLBACK_PROJECT_UUID;
  const fs = fsClient({
    client,
    subject: fsSubject({ project_id }),
    timeout: 15_000,
  });
  const marker = `cocalc-plus-windows-${Date.now()}`;
  await smokeHttp(port);
  const filename = ".cocalc-plus-windows-smoke.txt";
  await fs.writeFile(filename, marker);
  const stored = await fs.readFile(filename, "utf8");
  if (stored !== marker) {
    throw new Error(`filesystem smoke mismatch: ${JSON.stringify(stored)}`);
  }
  const names = await fs.readdir("");
  if (!names.includes(filename)) {
    throw new Error(
      "filesystem smoke file is missing from the project listing",
    );
  }

  const terminal = terminalClient({
    client,
    project_id,
    reconnection: false,
  });
  const terminalId = `windows-smoke-${Date.now()}`;
  try {
    await terminal.spawn("bash", [], {
      cwd: "/home/user",
      id: terminalId,
      path: "windows-smoke.term",
      timeout: 15_000,
    });
    await terminal.write({
      id: terminalId,
      input: `Write-Output ${marker}\r\n`,
      kind: "user",
    });
    await waitFor(async () =>
      `${await terminal.history(terminalId)}`.includes(marker),
    );
  } finally {
    await terminal.destroy().catch(() => {});
    terminal.close();
    await fs.rm(filename, { force: true }).catch(() => {});
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, http: true, files: true, powershell_terminal: true })}\n`,
  );
}
